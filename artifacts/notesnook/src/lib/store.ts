import { create } from 'zustand';
import {
  openVault, loadVault, saveVaultHandle, scanFolder, scanFolderSizes, readNote, saveNote,
  createNote, deleteNote, renameNote, clearVault, NoteFile,
  readVaultFile, writeVaultFile, deleteVaultFile,
} from './fileSystem';

import {
  loadAllMetadata, saveAllMetadata, updateNoteMeta, removeNoteMeta,
  getAllTags, MetadataMap, NoteStatus, AccentColor, DEFAULT_META,
} from './metadata';
import {
  Task, TaskMap, loadAllTasks, saveAllTasks,
  parseTasksFromContent, mergeTasks, toggleTaskInContent,
} from './tasks';
import {
  VAULT_KEY_FILENAME, isEncrypted, encryptContent, decryptContent,
  createKeyFileContent, openKeyFile,
} from './crypto';
import { saveVersion, reencryptVersions } from './versions';
import { migrateNoteAttachments } from './attachments';
import { backupNow as _backupNow, restoreFromCid as _restoreFromCid, loadSyncHistory as _loadSyncHistory, SyncRecord } from './syncEngine';
import { NoteSnapshot, SYNC_ENCRYPTION_MODE, getSyncEncryptionMode, setSyncEncryptionMode } from './syncEncryption';
import { getWalletInfo } from './lighthouseClient';

export const STORAGE_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB

// ─── Types ───────────────────────────────────────────────────────────────────

export type SidebarSection =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'tag'; tag: string }
  | { type: 'tasks-inbox' }
  | { type: 'tasks-today' }
  | { type: 'tasks-upcoming' }
  | { type: 'tasks-done' };

/** A file entry sent from Hollr via postMessage (proxy vault mode) */
export type ProxyFile = { name: string; content: string; lastModified?: number };

/** Helper to build a fake file handle used only in proxy mode (never actually called) */
function fakeHandle(name: string): FileSystemFileHandle {
  return { name } as unknown as FileSystemFileHandle;
}

/** Send a postMessage to the parent Hollr window */
function notifyParent(msg: Record<string, unknown>) {
  try { window.parent.postMessage(msg, '*'); } catch { /* noop if no parent */ }
}

interface NotesState {
  userId: number | null;
  vaultHandle: FileSystemDirectoryHandle | null;
  /** Name of folder when running in Hollr proxy mode (no real FS handles) */
  proxyVault: string | null;
  /** In-memory file content store used in proxy mode: filename → content */
  proxyContent: Record<string, string>;
  /** All notes merged with metadata */
  notes: NoteFile[];
  metadata: MetadataMap;
  tasks: TaskMap;
  activeNoteId: string | null;
  activeContent: string;
  isDirty: boolean;
  isLoading: boolean;
  searchQuery: string;
  activeSection: SidebarSection;
  theme: 'light' | 'dark';
  accentColor: AccentColor;
  encryptionKey: CryptoKey | null;
  isVaultEncrypted: boolean;

  /** Per-note file sizes in bytes (keyed by note ID / filename) */
  noteSizes: Record<string, number>;

  // Sync (Lighthouse cloud backup)
  syncStatus: 'idle' | 'uploading' | 'downloading' | 'error';
  syncError: string | null;
  lastSyncRecord: SyncRecord | null;
  syncHistory: SyncRecord[];
  walletAddress: string | null;
  hasLighthouseKey: boolean;
  syncEncryptionMode: string;

  // Vault
  init: (userId: number) => Promise<void>;
  reset: () => void;
  openNewVault: (userId: number) => Promise<void>;
  openVaultFromHandle: (userId: number, handle: FileSystemDirectoryHandle) => Promise<void>;
  openVaultFromProxy: (userId: number, name: string, files: ProxyFile[]) => Promise<void>;
  disconnectVault: (userId: number) => Promise<void>;
  refreshNotes: () => Promise<void>;

  // Encryption
  unlockVault: (password: string) => Promise<boolean>;
  lockVault: () => void;
  enableEncryption: (password: string) => Promise<void>;
  disableEncryption: () => Promise<void>;

  // Notes CRUD
  selectNote: (id: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveActiveNote: () => Promise<void>;
  createNewNote: (title?: string) => Promise<void>;
  renameNote: (id: string, newTitle: string) => Promise<void>;
  trashNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  permanentlyDeleteNote: (id: string) => Promise<void>;

  // Metadata actions
  toggleFavorite: (id: string) => Promise<void>;
  setNoteStatus: (id: string, status: NoteStatus) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  setReminder: (id: string, reminderTime: string | null) => Promise<void>;
  dismissReminder: (id: string) => Promise<void>;
  fireReminder: (id: string) => Promise<void>;

  // Task actions
  syncNoteTasks: (noteId: string, noteTitle: string, content: string) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  setTaskDueDate: (taskId: string, dueDate: string | null) => Promise<void>;
  createTaskNote: (text?: string) => Promise<void>;

  // Sync (Lighthouse cloud backup)
  initSync: (token: string) => Promise<void>;
  backupNow: (token: string) => Promise<void>;
  previewRestoreFromCid: (token: string, cid: string) => Promise<import('./syncEncryption').NoteSnapshot[]>;
  restoreSnapshots: (snapshots: import('./syncEncryption').NoteSnapshot[]) => Promise<void>;
  restoreFromCid: (token: string, cid: string) => Promise<void>;
  loadSyncHistory: () => Promise<void>;
  markPendingUpload: (noteId: string) => Promise<void>;
  setDevSyncMode: (mode: 'LIGHTHOUSE' | 'LOCAL_WEBCRYPTO') => void;

  // UI
  setActiveSection: (section: SidebarSection) => void;
  setSearchQuery: (query: string) => void;
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function activeNoteKey(userId: number) { return `ballpoint-active-${userId}`; }

function getInitialTheme(): 'light' | 'dark' {
  try {
    const s = localStorage.getItem('ballpoint-theme') as 'light' | 'dark' | null;
    if (s) return s;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'dark'; }
}

function getInitialAccent(): AccentColor {
  return (localStorage.getItem('ballpoint-accent') as AccentColor) ?? 'violet';
}

// PWA toolbar / status-bar theme-color per accent × theme
const THEME_COLORS: Record<AccentColor, { dark: string; light: string }> = {
  violet: { dark: '#1a1525', light: '#7c5cfc' },
  indigo: { dark: '#141328', light: '#5b4cf7' },
  blue:   { dark: '#121729', light: '#3b82f6' },
  cyan:   { dark: '#071d1e', light: '#0891b2' },
  teal:   { dark: '#0c1e1c', light: '#0d9488' },
  green:  { dark: '#0c1e10', light: '#16a34a' },
  amber:  { dark: '#1e1505', light: '#d97706' },
  orange: { dark: '#1e1208', light: '#ea580c' },
  rose:   { dark: '#1e0f14', light: '#e11d48' },
  pink:   { dark: '#1e0f1c', light: '#d535a7' },
};

const ALL_ACCENTS: AccentColor[] = ['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose', 'pink'];

function applyTheme(theme: 'light' | 'dark', accent: AccentColor) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  ALL_ACCENTS.forEach(a => root.classList.remove(`accent-${a}`));
  root.classList.add(`accent-${accent}`);

  const color = THEME_COLORS[accent]?.[theme] ?? '#141418';
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

// Apply saved theme immediately on module load (before React mounts)
applyTheme(getInitialTheme(), getInitialAccent());

/** Merge flat file list with metadata map into enriched NoteFile[] */
function mergeWithMeta(
  files: Pick<NoteFile, 'id' | 'handle' | 'name' | 'title' | 'lastModified'>[],
  meta: MetadataMap
): NoteFile[] {
  return files.map(f => {
    const m = { ...DEFAULT_META, ...meta[f.id] };
    return { ...f, ...m };
  });
}

/**
 * Background: scan ALL notes in the vault and build a complete task index.
 * Runs after init so the Tasks views have data for notes never explicitly opened.
 */
async function buildFullTaskIndex(
  userId: number,
  notes: NoteFile[],
  existingTasks: TaskMap,
  encryptionKey: CryptoKey | null,
  proxyContent?: Record<string, string>
): Promise<TaskMap> {
  let allTasks = { ...existingTasks };
  for (const note of notes) {
    if (note.status !== 'active') continue;
    try {
      let content = proxyContent
        ? (proxyContent[note.id] ?? '')
        : await readNote(note.handle);
      if (isEncrypted(content)) {
        if (!encryptionKey) continue; // can't parse without key
        content = await decryptContent(content, encryptionKey);
      }
      const parsed = parseTasksFromContent(note.id, note.title, content);
      const otherTasks = Object.fromEntries(
        Object.entries(allTasks).filter(([, t]) => t.noteId !== note.id)
      );
      const merged = mergeTasks(parsed, allTasks);
      allTasks = { ...otherTasks, ...merged };
    } catch { /* skip unreadable notes */ }
  }
  await saveAllTasks(userId, allTasks);
  return allTasks;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useNotesStore = create<NotesState>((set, get) => ({
  userId: null,
  vaultHandle: null,
  proxyVault: null,
  proxyContent: {},
  notes: [],
  metadata: {},
  tasks: {},
  activeNoteId: null,
  activeContent: '',
  isDirty: false,
  isLoading: true,
  searchQuery: '',
  activeSection: { type: 'all' },
  theme: getInitialTheme(),
  accentColor: getInitialAccent(),
  encryptionKey: null,
  isVaultEncrypted: false,
  noteSizes: {},

  syncStatus: 'idle',
  syncError: null,
  lastSyncRecord: null,
  syncHistory: [],
  walletAddress: null,
  hasLighthouseKey: false,
  syncEncryptionMode: SYNC_ENCRYPTION_MODE,

  init: async (userId) => {
    set({ isLoading: true, userId });
    applyTheme(get().theme, get().accentColor);

    const handle = await loadVault(userId);
    if (handle) {
      const [rawFiles, meta, existingTasks, keyFile] = await Promise.all([
        scanFolder(handle),
        loadAllMetadata(userId),
        loadAllTasks(userId),
        readVaultFile(handle, VAULT_KEY_FILENAME),
      ]);
      const notes = mergeWithMeta(rawFiles, meta);
      const isVaultEncrypted = keyFile !== null;
      set({ vaultHandle: handle, notes, metadata: meta, tasks: existingTasks, isVaultEncrypted, encryptionKey: null, isLoading: false });
      scanFolderSizes(handle).then(noteSizes => set({ noteSizes })).catch(() => {});

      if (!isVaultEncrypted) {
        // Unencrypted vault — open notes normally
        const lastId = localStorage.getItem(activeNoteKey(userId));
        if (lastId && notes.find(n => n.id === lastId)) {
          get().selectNote(lastId);
        } else {
          const first = notes.find(n => n.status === 'active');
          if (first) get().selectNote(first.id);
        }
        buildFullTaskIndex(userId, notes, existingTasks, null)
          .then(tasks => set({ tasks }))
          .catch(() => {});
      }
      // If encrypted — wait for unlockVault() to be called
    } else {
      set({ isLoading: false });
    }
  },

  reset: () => set({
    userId: null, vaultHandle: null, notes: [], metadata: {}, tasks: {},
    activeNoteId: null, activeContent: '', isDirty: false, isLoading: false, searchQuery: '',
    encryptionKey: null, isVaultEncrypted: false, noteSizes: {},
  }),

  openNewVault: async (userId) => {
    const handle = await openVault(userId);
    if (!handle) return;
    set({ isLoading: true });
    const [rawFiles, meta, existingTasks, keyFile] = await Promise.all([
      scanFolder(handle),
      loadAllMetadata(userId),
      loadAllTasks(userId),
      readVaultFile(handle, VAULT_KEY_FILENAME),
    ]);
    const notes = mergeWithMeta(rawFiles, meta);
    const isVaultEncrypted = keyFile !== null;
    set({ vaultHandle: handle, notes, metadata: meta, tasks: existingTasks, activeNoteId: null, activeContent: '', isDirty: false, isLoading: false, isVaultEncrypted, encryptionKey: null });
    scanFolderSizes(handle).then(noteSizes => set({ noteSizes })).catch(() => {});
    if (!isVaultEncrypted) {
      const first = notes.find(n => n.status === 'active');
      if (first) get().selectNote(first.id);
      buildFullTaskIndex(userId, notes, existingTasks, null)
        .then(tasks => set({ tasks }))
        .catch(() => {});
    }
  },

  openVaultFromHandle: async (userId, handle) => {
    // Best-effort permission request — already granted by the parent in most cases
    try {
      const perm = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
    } catch { /* parent may have pre-granted; proceed */ }

    set({ isLoading: true });
    await saveVaultHandle(userId, handle);
    const [rawFiles, meta, existingTasks, keyFile] = await Promise.all([
      scanFolder(handle),
      loadAllMetadata(userId),
      loadAllTasks(userId),
      readVaultFile(handle, VAULT_KEY_FILENAME),
    ]);
    const notes = mergeWithMeta(rawFiles, meta);
    const isVaultEncrypted = keyFile !== null;
    set({ vaultHandle: handle, notes, metadata: meta, tasks: existingTasks, activeNoteId: null, activeContent: '', isDirty: false, isLoading: false, isVaultEncrypted, encryptionKey: null });
    scanFolderSizes(handle).then(noteSizes => set({ noteSizes })).catch(() => {});
    if (!isVaultEncrypted) {
      const first = notes.find(n => n.status === 'active');
      if (first) get().selectNote(first.id);
      buildFullTaskIndex(userId, notes, existingTasks, null)
        .then(tasks => set({ tasks }))
        .catch(() => {});
    }
  },

  openVaultFromProxy: async (userId, name, files) => {
    set({ isLoading: true });
    const proxyContent: Record<string, string> = {};
    const proxyNoteSizes: Record<string, number> = {};
    const rawFiles = files
      .filter(f => f.name.endsWith('.md') || f.name.endsWith('.txt'))
      .map(f => {
        proxyContent[f.name] = f.content;
        proxyNoteSizes[f.name] = new TextEncoder().encode(f.content).length;
        return {
          id: f.name,
          handle: fakeHandle(f.name),
          name: f.name,
          title: f.name.replace(/\.(md|txt)$/, ''),
          lastModified: f.lastModified ?? Date.now(),
        };
      });
    const [meta, existingTasks] = await Promise.all([
      loadAllMetadata(userId),
      loadAllTasks(userId),
    ]);
    const notes = mergeWithMeta(rawFiles, meta);
    set({
      vaultHandle: null,
      proxyVault: name,
      proxyContent,
      notes,
      metadata: meta,
      tasks: existingTasks,
      activeNoteId: null,
      activeContent: '',
      isDirty: false,
      isLoading: false,
      isVaultEncrypted: false,
      encryptionKey: null,
      noteSizes: proxyNoteSizes,
    });
    const first = notes.find(n => n.status === 'active');
    if (first) get().selectNote(first.id);
    buildFullTaskIndex(userId, notes, existingTasks, null, proxyContent)
      .then(tasks => set({ tasks }))
      .catch(() => {});
  },

  disconnectVault: async (userId) => {
    await clearVault(userId);
    localStorage.removeItem(activeNoteKey(userId));
    set({ vaultHandle: null, proxyVault: null, proxyContent: {}, notes: [], metadata: {}, tasks: {}, activeNoteId: null, activeContent: '', isDirty: false, encryptionKey: null, isVaultEncrypted: false, noteSizes: {} });
  },

  refreshNotes: async () => {
    const { vaultHandle, proxyVault, proxyContent, metadata } = get();
    if (proxyVault !== null) {
      // In proxy mode: re-derive the notes list from in-memory content
      const rawFiles = Object.keys(proxyContent)
        .filter(n => n.endsWith('.md') || n.endsWith('.txt'))
        .map(n => ({
          id: n,
          handle: fakeHandle(n),
          name: n,
          title: n.replace(/\.(md|txt)$/, ''),
          lastModified: Date.now(),
        }));
      set({ notes: mergeWithMeta(rawFiles, metadata) });
      return;
    }
    const rawFiles = await scanFolder(vaultHandle!);
    const notes = mergeWithMeta(rawFiles, metadata);
    set({ notes });
  },

  selectNote: async (id) => {
    const state = get();
    if (state.isDirty && state.activeNoteId) await state.saveActiveNote();
    const note = state.notes.find(n => n.id === id);
    if (note && state.userId !== null) {
      let content: string;
      if (state.proxyVault !== null) {
        content = state.proxyContent[id] ?? '';
      } else {
        content = await readNote(note.handle);
        if (isEncrypted(content)) {
          content = state.encryptionKey
            ? await decryptContent(content, state.encryptionKey)
            : '[Encrypted — unlock vault to view]';
        }
      }
      localStorage.setItem(activeNoteKey(state.userId), id);
      const sizeBytes = new TextEncoder().encode(content).length;
      set(s => ({ activeNoteId: id, activeContent: content, isDirty: false, noteSizes: { ...s.noteSizes, [id]: sizeBytes } }));
      // Sync tasks in background (don't await so UI is snappy)
      get().syncNoteTasks(id, note.title, content).catch(() => {});
    }
  },

  updateContent: (content) => set({ activeContent: content, isDirty: true }),

  saveActiveNote: async () => {
    const { activeNoteId, vaultHandle, proxyVault, notes, activeContent, encryptionKey, userId } = get();
    if (!activeNoteId || !userId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    if (proxyVault !== null) {
      // Proxy mode: update in-memory store and notify Hollr to write the file
      const proxyBytes = new TextEncoder().encode(activeContent).length;
      set(s => ({ proxyContent: { ...s.proxyContent, [activeNoteId]: activeContent }, isDirty: false, noteSizes: { ...s.noteSizes, [activeNoteId]: proxyBytes } }));
      notifyParent({ type: 'ballpoint:write-file', name: activeNoteId, content: activeContent });
      get().syncNoteTasks(activeNoteId, note.title, activeContent).catch(() => {});
      get().markPendingUpload(activeNoteId).catch(() => {});
      return;
    }

    if (!vaultHandle) return;
    const contentToSave = encryptionKey
      ? await encryptContent(activeContent, encryptionKey)
      : activeContent;
    await saveNote(note.handle, contentToSave);
    // Snapshot version — encrypted at rest when vault has a key
    saveVersion(userId, activeNoteId, activeContent, encryptionKey).catch(() => {});
    const savedBytes = new TextEncoder().encode(activeContent).length;
    set(s => ({ isDirty: false, noteSizes: { ...s.noteSizes, [activeNoteId]: savedBytes } }));
    await get().refreshNotes();
    get().syncNoteTasks(activeNoteId, note.title, activeContent).catch(() => {});
    get().markPendingUpload(activeNoteId).catch(() => {});
  },

  createNewNote: async (title = 'Untitled') => {
    const { vaultHandle, proxyVault, userId, notes, isDirty, activeNoteId, noteSizes } = get();
    if (!userId) return;
    if (isDirty && activeNoteId) await get().saveActiveNote();

    // Guard: need either a real vault or proxy vault
    if (!vaultHandle && proxyVault === null) return;

    // 100 MB storage limit
    const totalBytes = Object.values(noteSizes).reduce((a, b) => a + b, 0);
    if (totalBytes >= STORAGE_LIMIT_BYTES) {
      alert('You have reached the 100 MB storage limit. Please delete some notes to free up space.');
      return;
    }

    let finalTitle = title;
    let i = 1;
    while (notes.some(n => n.title === finalTitle)) finalTitle = `${title} ${i++}`;

    if (proxyVault !== null) {
      // Proxy mode: create file in memory, notify Hollr
      const safe = finalTitle.replace(/[/\\?%*:|"<>]/g, '-');
      const filename = `${safe}.md`;
      const meta = await updateNoteMeta(userId, filename, { status: 'active', remoteStatus: 'pendingUpload' });
      set(s => ({
        proxyContent: { ...s.proxyContent, [filename]: '' },
        metadata: meta,
      }));
      notifyParent({ type: 'ballpoint:create-file', name: filename, content: '' });
      await get().refreshNotes();
      await get().selectNote(filename);
      set({ activeSection: { type: 'all' } });
      return;
    }

    const handle = await createNote(vaultHandle!, finalTitle);
    const meta = await updateNoteMeta(userId, handle.name, { status: 'active', remoteStatus: 'pendingUpload' });
    set({ metadata: meta });
    await get().refreshNotes();
    await get().selectNote(handle.name);
    set({ activeSection: { type: 'all' } });
  },

  renameNote: async (id, newTitle) => {
    const { vaultHandle, proxyVault, userId, notes, metadata, activeNoteId } = get();
    if (!userId || !newTitle.trim()) return;
    if (!vaultHandle && proxyVault === null) return;
    const note = notes.find(n => n.id === id);
    if (!note || note.title === newTitle) return;

    const safe = newTitle.replace(/[/\\?%*:|"<>]/g, '-');
    const newName = `${safe}.md`;

    let resolvedNewName: string;

    if (proxyVault !== null) {
      // Proxy mode: update in-memory content map
      const currentContent = get().proxyContent[id] ?? '';
      set(s => {
        const updated = { ...s.proxyContent };
        updated[newName] = currentContent;
        delete updated[id];
        return { proxyContent: updated };
      });
      notifyParent({ type: 'ballpoint:rename-file', oldName: id, newName, content: currentContent });
      resolvedNewName = newName;
    } else {
      const newHandle = await renameNote(vaultHandle!, note.handle, newTitle);
      resolvedNewName = newHandle.name;
    }

    const oldMeta = metadata[id];
    const newMeta = { ...metadata };
    if (oldMeta) {
      newMeta[resolvedNewName] = { ...oldMeta, remoteStatus: 'pendingUpload' };
      delete newMeta[id];
    }
    await saveAllMetadata(userId, newMeta);
    set({ metadata: newMeta });
    await get().refreshNotes();

    // Move tasks to new note ID
    const { tasks } = get();
    const newTasks: TaskMap = {};
    for (const [key, t] of Object.entries(tasks)) {
      if (t.noteId === id) {
        const newId = key.replace(`${id}::`, `${resolvedNewName}::`);
        newTasks[newId] = { ...t, id: newId, noteId: resolvedNewName, noteTitle: newTitle };
      } else {
        newTasks[key] = t;
      }
    }
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    if (activeNoteId === id && userId) {
      localStorage.setItem(activeNoteKey(userId), resolvedNewName);
      set({ activeNoteId: resolvedNewName });
    }
  },

  trashNote: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { status: 'trashed', trashedAt: Date.now() }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();

    // Remove tasks for trashed note
    const { tasks } = get();
    const newTasks = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.noteId !== id));
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    if (get().activeNoteId === id) {
      const next = get().notes.find(n => n.status === 'active');
      if (next) get().selectNote(next.id);
      else set({ activeNoteId: null, activeContent: '', isDirty: false });
    }
  },

  restoreNote: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { status: 'active', trashedAt: undefined }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  permanentlyDeleteNote: async (id) => {
    const { vaultHandle, proxyVault, userId, activeNoteId, notes } = get();
    if (!userId) return;
    if (!vaultHandle && proxyVault === null) return;

    if (proxyVault !== null) {
      set(s => {
        const updated = { ...s.proxyContent };
        delete updated[id];
        const sizes = { ...s.noteSizes };
        delete sizes[id];
        return { proxyContent: updated, noteSizes: sizes };
      });
      notifyParent({ type: 'ballpoint:delete-file', name: id });
    } else {
      await deleteNote(vaultHandle!, id);
      set(s => {
        const sizes = { ...s.noteSizes };
        delete sizes[id];
        return { noteSizes: sizes };
      });
    }
    const newMeta = await removeNoteMeta(userId, id);
    set({ metadata: newMeta });

    // Remove tasks for deleted note
    const { tasks } = get();
    const newTasks = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.noteId !== id));
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    await get().refreshNotes();
    if (activeNoteId === id) {
      const next = notes.find(n => n.id !== id && n.status === 'active');
      if (next) get().selectNote(next.id);
      else set({ activeNoteId: null, activeContent: '', isDirty: false });
    }
  },

  toggleFavorite: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const current = metadata[id]?.isFavorite ?? false;
    const newMeta = await updateNoteMeta(userId, id, { isFavorite: !current }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  setNoteStatus: async (id, status) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { status }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  setTags: async (id, tags) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { tags }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  setReminder: async (id, reminderTime) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const updates = reminderTime
      ? { hasReminder: true, reminderTime, reminderStatus: 'pending' as const }
      : { hasReminder: false, reminderTime: undefined, reminderStatus: undefined };
    const newMeta = await updateNoteMeta(userId, id, updates, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  dismissReminder: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { reminderStatus: 'dismissed' }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  fireReminder: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { reminderStatus: 'fired' }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();
  },

  // ── Task actions ──────────────────────────────────────────────────────────

  syncNoteTasks: async (noteId, noteTitle, content) => {
    const { userId, tasks } = get();
    if (!userId) return;
    const parsed = parseTasksFromContent(noteId, noteTitle, content);
    const otherTasks = Object.fromEntries(
      Object.entries(tasks).filter(([, t]) => t.noteId !== noteId)
    );
    const merged = mergeTasks(parsed, tasks);
    const newTasks = { ...otherTasks, ...merged };
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });
  },

  toggleTask: async (taskId) => {
    const { userId, tasks, activeNoteId, activeContent, notes, encryptionKey } = get();
    if (!userId) return;
    const task = tasks[taskId];
    if (!task) return;

    const note = notes.find(n => n.id === task.noteId);
    if (!note) return;

    const newCompleted = !task.completed;

    // Read content from memory (if active) or from disk (and decrypt if needed)
    let content: string;
    if (activeNoteId === task.noteId) {
      content = activeContent;
    } else {
      const raw = await readNote(note.handle);
      content = (isEncrypted(raw) && encryptionKey)
        ? await decryptContent(raw, encryptionKey)
        : raw;
    }
    const newContent = toggleTaskInContent(content, task.lineIndex, newCompleted);

    // Re-encrypt if needed before saving
    const toSave = encryptionKey
      ? await encryptContent(newContent, encryptionKey)
      : newContent;
    await saveNote(note.handle, toSave);

    // If toggled note is the open one, update editor content too
    if (activeNoteId === task.noteId) {
      set({ activeContent: newContent, isDirty: false });
    }

    await get().refreshNotes();
    await get().syncNoteTasks(task.noteId, note.title, newContent);
  },

  setTaskDueDate: async (taskId, dueDate) => {
    const { userId, tasks } = get();
    if (!userId) return;
    const task = tasks[taskId];
    if (!task) return;
    const updated: Task = { ...task, dueDate: dueDate ?? undefined, updatedAt: Date.now() };
    const newTasks = { ...tasks, [taskId]: updated };
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });
  },

  createTaskNote: async (text = 'New task') => {
    const { vaultHandle, userId } = get();
    if (!vaultHandle || !userId) return;
    await get().createNewNote(text);
    // Pre-populate with a task line
    const initialContent = `- [ ] ${text}\n`;
    get().updateContent(initialContent);
    await get().saveActiveNote();
  },

  // ── Encryption ────────────────────────────────────────────────────────────

  unlockVault: async (password) => {
    const { vaultHandle, userId, notes, tasks: existingTasks } = get();
    if (!vaultHandle || !userId) return false;
    const keyFileContent = await readVaultFile(vaultHandle, VAULT_KEY_FILENAME);
    if (!keyFileContent) return false;
    const key = await openKeyFile(keyFileContent, password);
    if (!key) return false;

    set({ encryptionKey: key });

    // Auto-open last/first note now that we have the key
    const lastId = localStorage.getItem(activeNoteKey(userId));
    if (lastId && notes.find(n => n.id === lastId)) {
      get().selectNote(lastId);
    } else {
      const first = notes.find(n => n.status === 'active');
      if (first) get().selectNote(first.id);
    }

    // Rebuild task index with the decryption key
    buildFullTaskIndex(userId, notes, existingTasks, key)
      .then(tasks => set({ tasks }))
      .catch(() => {});

    return true;
  },

  lockVault: () => {
    set({ encryptionKey: null, activeNoteId: null, activeContent: '', isDirty: false });
  },

  enableEncryption: async (password) => {
    const { vaultHandle, userId, notes, encryptionKey } = get();
    if (!vaultHandle || !userId || encryptionKey) return; // already encrypted

    const { key, content: keyContent } = await createKeyFileContent(password);
    await writeVaultFile(vaultHandle, VAULT_KEY_FILENAME, keyContent);

    // Encrypt all existing note files AND their version snapshots in IndexedDB
    for (const note of notes) {
      try {
        const raw = await readNote(note.handle);
        if (!isEncrypted(raw)) {
          const enc = await encryptContent(raw, key);
          await saveNote(note.handle, enc);
        }
      } catch { /* skip unreadable */ }
      // Migrate existing plaintext snapshots → encrypted
      await reencryptVersions(userId, note.id, null, key).catch(() => {});
      // Migrate existing plaintext attachment files → encrypted
      await migrateNoteAttachments(vaultHandle, note.id, null, key).catch(() => {});
    }

    set({ encryptionKey: key, isVaultEncrypted: true });

    // Refresh the active note's content from memory (already decrypted in editor)
    const { activeNoteId } = get();
    if (activeNoteId) get().selectNote(activeNoteId);
  },

  disableEncryption: async () => {
    const { vaultHandle, userId, notes, encryptionKey } = get();
    if (!vaultHandle || !userId || !encryptionKey) return;

    // Decrypt and rewrite every note file AND their version snapshots
    for (const note of notes) {
      try {
        const raw = await readNote(note.handle);
        if (isEncrypted(raw)) {
          const plain = await decryptContent(raw, encryptionKey);
          await saveNote(note.handle, plain);
        }
      } catch { /* skip */ }
      // Migrate encrypted snapshots → plaintext
      await reencryptVersions(userId, note.id, encryptionKey, null).catch(() => {});
      // Migrate encrypted attachment files → plaintext
      await migrateNoteAttachments(vaultHandle, note.id, encryptionKey, null).catch(() => {});
    }

    await deleteVaultFile(vaultHandle, VAULT_KEY_FILENAME);
    set({ encryptionKey: null, isVaultEncrypted: false });
  },

  // ── Sync (Lighthouse cloud backup) ───────────────────────────────────────

  initSync: async (token) => {
    try {
      const [walletInfo, history] = await Promise.all([
        getWalletInfo(token),
        (async () => {
          const uid = get().userId;
          return uid ? _loadSyncHistory(uid) : [];
        })(),
      ]);
      set({
        walletAddress: walletInfo.address,
        hasLighthouseKey: walletInfo.hasLighthouseKey,
        syncHistory: history,
        lastSyncRecord: history[0] ?? null,
      });
    } catch {
      // Sync init is non-fatal — app still works without it
    }
  },

  backupNow: async (token) => {
    const { userId, notes, metadata, encryptionKey } = get();
    if (!userId) return;

    set({ syncStatus: 'uploading', syncError: null });
    try {
      // Serialize ALL notes (active, archived, trashed) as plaintext snapshots for the backup.
      // Trashed/archived notes are included so a restore brings back the full note state.
      // If vault is encrypted, content is decrypted before serialization.
      const allNotes = notes;
      const snapshots: NoteSnapshot[] = [];

      for (const note of allNotes) {
        try {
          let content = '';
          if (get().proxyVault !== null) {
            content = get().proxyContent[note.id] ?? '';
          } else if (get().vaultHandle) {
            const { readNote: rn } = await import('./fileSystem');
            const { isEncrypted: ie, decryptContent: dc } = await import('./crypto');
            const raw = await rn(note.handle);
            content = (ie(raw) && encryptionKey) ? await dc(raw, encryptionKey) : raw;
          }
          snapshots.push({ id: note.id, title: note.title, content, lastModified: note.lastModified });
        } catch { /* skip unreadable */ }
      }

      const record = await _backupNow(token, userId, snapshots);
      set({ syncStatus: 'idle', lastSyncRecord: record, syncHistory: [record, ...get().syncHistory].slice(0, 50) });

      // Mark all notes as synced
      const newMeta = { ...metadata };
      for (const note of allNotes) {
        if (newMeta[note.id]) newMeta[note.id] = { ...newMeta[note.id], remoteStatus: 'synced' };
      }
      await saveAllMetadata(userId, newMeta);
      set({ metadata: newMeta });
      await get().refreshNotes();
    } catch (err: any) {
      set({ syncStatus: 'error', syncError: err.message ?? 'Backup failed' });
    }
  },

  previewRestoreFromCid: async (token, cid) => {
    const { userId } = get();
    if (!userId) throw new Error('Not signed in');
    set({ syncStatus: 'downloading', syncError: null });
    try {
      const snapshots = await _restoreFromCid(token, userId, cid);
      set({ syncStatus: 'idle' });
      return snapshots;
    } catch (err: any) {
      set({ syncStatus: 'error', syncError: err.message ?? 'Decrypt failed' });
      throw err;
    }
  },

  restoreSnapshots: async (snapshots) => {
    const { vaultHandle, proxyVault, encryptionKey } = get();
    set({ syncStatus: 'downloading', syncError: null });
    try {
      if (proxyVault !== null) {
        const updated = { ...get().proxyContent };
        for (const snap of snapshots) {
          updated[snap.id] = snap.content;
          notifyParent({ type: 'ballpoint:write-file', name: snap.id, content: snap.content });
        }
        set({ proxyContent: updated });
      } else if (vaultHandle) {
        const { saveNote: sn, createNote: cn, renameNote: rnote } = await import('./fileSystem');
        const { encryptContent: ec } = await import('./crypto');
        for (const snap of snapshots) {
          const content = encryptionKey ? await ec(snap.content, encryptionKey) : snap.content;
          try {
            const note = get().notes.find(n => n.id === snap.id);
            if (note) {
              await sn(note.handle, content);
              if (note.title !== snap.title) {
                try { await rnote(vaultHandle, note.handle, snap.title); } catch { /* ignore rename errors */ }
              }
            } else {
              const newHandle = await cn(vaultHandle, snap.title);
              await sn(newHandle, content);
            }
          } catch { /* skip unreadable or fs-error notes */ }
        }
      } else {
        throw new Error('No vault is open. Open your vault folder first, then restore.');
      }
      await get().refreshNotes();
      set({ syncStatus: 'idle' });
    } catch (err: any) {
      set({ syncStatus: 'error', syncError: err.message ?? 'Restore failed' });
      throw err;
    }
  },

  restoreFromCid: async (token, cid) => {
    const { userId } = get();
    if (!userId) return;
    try {
      const snapshots = await get().previewRestoreFromCid(token, cid);
      await get().restoreSnapshots(snapshots);
    } catch { /* errors already set on store */ }
  },

  loadSyncHistory: async () => {
    const { userId } = get();
    if (!userId) return;
    const history = await _loadSyncHistory(userId);
    set({ syncHistory: history, lastSyncRecord: history[0] ?? null });
  },

  markPendingUpload: async (noteId) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const current = metadata[noteId]?.remoteStatus;
    if (current === 'synced' || current === undefined) {
      const newMeta = await updateNoteMeta(userId, noteId, { remoteStatus: 'pendingUpload' }, { ...metadata });
      set({ metadata: newMeta });
    }
  },

  setDevSyncMode: (mode) => {
    setSyncEncryptionMode(mode);
    set({ syncEncryptionMode: mode });
  },

  // ── UI ────────────────────────────────────────────────────────────────────

  setActiveSection: (section) => set({ activeSection: section, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('ballpoint-theme', newTheme);
    applyTheme(newTheme, get().accentColor);
    set({ theme: newTheme });
  },

  setAccentColor: (color) => {
    localStorage.setItem('ballpoint-accent', color);
    applyTheme(get().theme, color);
    set({ accentColor: color });
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

export function selectFilteredNotes(state: NotesState): NoteFile[] {
  const { notes, activeSection, searchQuery } = state;

  let list = notes.filter(n => {
    switch (activeSection.type) {
      case 'all': return n.status === 'active';
      case 'favorites': return n.status === 'active' && n.isFavorite;
      case 'archive': return n.status === 'archived';
      case 'trash': return n.status === 'trashed';
      case 'tag': return n.status === 'active' && n.tags.includes(activeSection.tag);
      default: return false;
    }
  });

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  if (activeSection.type === 'all') {
    list = [...list.filter(n => n.isFavorite), ...list.filter(n => !n.isFavorite)];
  }

  return list;
}

export function selectAllTags(state: NotesState): string[] {
  return getAllTags(state.metadata, state.notes);
}

export function selectCounts(state: NotesState) {
  return {
    all:       state.notes.filter(n => n.status === 'active').length,
    favorites: state.notes.filter(n => n.status === 'active' && n.isFavorite).length,
    archive:   state.notes.filter(n => n.status === 'archived').length,
    trash:     state.notes.filter(n => n.status === 'trashed').length,
  };
}

export function isTaskSection(section: SidebarSection): boolean {
  return section.type.startsWith('tasks-');
}
