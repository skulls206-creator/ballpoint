import { create } from 'zustand';
import {
  openVault, loadVault, saveVaultHandle, scanFolder, readNote, saveNote,
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

interface NotesState {
  userId: number | null;
  vaultHandle: FileSystemDirectoryHandle | null;
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

  // Vault
  init: (userId: number) => Promise<void>;
  reset: () => void;
  openNewVault: (userId: number) => Promise<void>;
  openVaultFromHandle: (userId: number, handle: FileSystemDirectoryHandle) => Promise<void>;
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
  encryptionKey: CryptoKey | null
): Promise<TaskMap> {
  let allTasks = { ...existingTasks };
  for (const note of notes) {
    if (note.status !== 'active') continue;
    try {
      let content = await readNote(note.handle);
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
    encryptionKey: null, isVaultEncrypted: false,
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
    if (!isVaultEncrypted) {
      const first = notes.find(n => n.status === 'active');
      if (first) get().selectNote(first.id);
      buildFullTaskIndex(userId, notes, existingTasks, null)
        .then(tasks => set({ tasks }))
        .catch(() => {});
    }
  },

  disconnectVault: async (userId) => {
    await clearVault(userId);
    localStorage.removeItem(activeNoteKey(userId));
    set({ vaultHandle: null, notes: [], metadata: {}, tasks: {}, activeNoteId: null, activeContent: '', isDirty: false, encryptionKey: null, isVaultEncrypted: false });
  },

  refreshNotes: async () => {
    const { vaultHandle, userId, metadata } = get();
    if (!vaultHandle || !userId) return;
    const rawFiles = await scanFolder(vaultHandle);
    const notes = mergeWithMeta(rawFiles, metadata);
    set({ notes });
  },

  selectNote: async (id) => {
    const state = get();
    if (state.isDirty && state.activeNoteId) await state.saveActiveNote();
    const note = state.notes.find(n => n.id === id);
    if (note && state.userId !== null) {
      let content = await readNote(note.handle);
      if (isEncrypted(content)) {
        content = state.encryptionKey
          ? await decryptContent(content, state.encryptionKey)
          : '[Encrypted — unlock vault to view]';
      }
      localStorage.setItem(activeNoteKey(state.userId), id);
      set({ activeNoteId: id, activeContent: content, isDirty: false });
      // Sync tasks in background (don't await so UI is snappy)
      get().syncNoteTasks(id, note.title, content).catch(() => {});
    }
  },

  updateContent: (content) => set({ activeContent: content, isDirty: true }),

  saveActiveNote: async () => {
    const { activeNoteId, vaultHandle, notes, activeContent, encryptionKey, userId } = get();
    if (!activeNoteId || !vaultHandle || !userId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
      const contentToSave = encryptionKey
        ? await encryptContent(activeContent, encryptionKey)
        : activeContent;
      await saveNote(note.handle, contentToSave);
      // Snapshot version — encrypted at rest when vault has a key
      saveVersion(userId, activeNoteId, activeContent, encryptionKey).catch(() => {});
      set({ isDirty: false });
      await get().refreshNotes();
      get().syncNoteTasks(activeNoteId, note.title, activeContent).catch(() => {});
    }
  },

  createNewNote: async (title = 'Untitled') => {
    const { vaultHandle, userId, notes, isDirty, activeNoteId } = get();
    if (!vaultHandle || !userId) return;
    if (isDirty && activeNoteId) await get().saveActiveNote();

    let finalTitle = title;
    let i = 1;
    while (notes.some(n => n.title === finalTitle)) finalTitle = `${title} ${i++}`;

    const handle = await createNote(vaultHandle, finalTitle);
    const meta = await updateNoteMeta(userId, handle.name, { status: 'active' });
    set({ metadata: meta });
    await get().refreshNotes();
    await get().selectNote(handle.name);
    set({ activeSection: { type: 'all' } });
  },

  renameNote: async (id, newTitle) => {
    const { vaultHandle, userId, notes, metadata, activeNoteId } = get();
    if (!vaultHandle || !userId || !newTitle.trim()) return;
    const note = notes.find(n => n.id === id);
    if (!note || note.title === newTitle) return;

    const newHandle = await renameNote(vaultHandle, note.handle, newTitle);

    const oldMeta = metadata[id];
    const newMeta = { ...metadata };
    if (oldMeta) {
      newMeta[newHandle.name] = oldMeta;
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
        const newId = key.replace(`${id}::`, `${newHandle.name}::`);
        newTasks[newId] = { ...t, id: newId, noteId: newHandle.name, noteTitle: newTitle };
      } else {
        newTasks[key] = t;
      }
    }
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    if (activeNoteId === id && userId) {
      localStorage.setItem(activeNoteKey(userId), newHandle.name);
      set({ activeNoteId: newHandle.name });
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
    const { vaultHandle, userId, activeNoteId, notes } = get();
    if (!vaultHandle || !userId) return;
    await deleteNote(vaultHandle, id);
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
