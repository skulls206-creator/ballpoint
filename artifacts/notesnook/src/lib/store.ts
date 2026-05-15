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
import {
  getR2Status, getR2Key, putR2Key, listR2Notes, getR2Note, putR2Note, deleteR2Note,
  getR2Metadata, putR2Metadata, getR2Tasks, putR2Tasks,
} from './r2Client';
import {
  enqueueR2Op, flushR2Queue, initR2Queue, clearR2Queue,
  onR2PendingCountChange, getR2PendingCount,
} from './r2Queue';

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

/** Allowed parent origins for KHURK OS proxy vault postMessage (glob patterns). */
const ALLOWED_PARENT_ORIGINS = [
  '*.hollr.chat',
  '*.khurk.xyz',
  '*.replit.dev',
];

function originMatchesPattern(origin: string, pattern: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // '.hollr.chat'
      return hostname === suffix.slice(1) || hostname.endsWith(suffix);
    }
    return origin === pattern;
  } catch { return false; }
}

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_PARENT_ORIGINS.some(p => originMatchesPattern(origin, p));
}

/** Determine the embedding origin from the parent context. */
function getParentOrigin(): string | null {
  try {
    if (window.location.ancestorOrigins?.length > 0) {
      const o = window.location.ancestorOrigins[0];
      if (isOriginAllowed(o)) return o;
    }
  } catch { /* cross-origin */ }
  try {
    const ref = document.referrer;
    if (ref) {
      const o = new URL(ref).origin;
      if (isOriginAllowed(o)) return o;
    }
  } catch { /* empty referrer */ }
  return null;
}

/** Send a postMessage to the parent KHURK OS window — only to known origins, never '*' */
function notifyParent(msg: Record<string, unknown>) {
  const origin = getParentOrigin();
  if (!origin) return;
  try { window.parent.postMessage(msg, origin); } catch { /* noop if no parent */ }
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

  /** Notes unlocked this session (lock is UI-only; vault crypto handles real security) */
  sessionUnlockedIds: Set<string>;

  // Sync (Lighthouse cloud backup)
  syncStatus: 'idle' | 'uploading' | 'downloading' | 'error';
  syncError: string | null;
  lastSyncRecord: SyncRecord | null;
  syncHistory: SyncRecord[];
  walletAddress: string | null;
  hasLighthouseKey: boolean;
  syncEncryptionMode: string;

  // R2 cloud storage
  /** Which storage backend is active for this session. */
  storageMode: 'local' | 'r2' | 'local+r2';
  r2Mode: boolean;
  r2Token: string | null;
  /** Dedicated encryption key used for all R2 cloud operations.
   *  - Pure R2 mode: derived from the R2 vault password.
   *  - local+r2 mode: mirrors the local vault's encryptionKey (single authoritative key).
   *  Kept separate so local and cloud keys are always consistent after reload. */
  r2EncryptionKey: CryptoKey | null;
  r2Status: 'idle' | 'syncing' | 'error';
  r2Error: string | null;
  r2LastSynced: number | null;
  r2Configured: boolean;
  /** Number of operations waiting in the IndexedDB offline sync queue. */
  r2PendingCount: number;

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
  togglePinned: (id: string) => Promise<void>;
  lockNote: (id: string, password: string) => Promise<void>;
  removeLock: (id: string) => Promise<void>;
  sessionUnlock: (id: string) => void;
  sessionLock: (id: string) => void;
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

  // R2 cloud storage
  checkR2Status: () => Promise<void>;
  openR2Vault: (userId: number, token: string, password: string) => Promise<void>;
  createR2Vault: (userId: number, token: string, password: string) => Promise<void>;
  disconnectR2Vault: (userId: number) => Promise<void>;
  /** Enable R2 as a background sync layer alongside the local FS vault (desktop local+r2 mode). */
  enableR2Sync: (token: string, password: string) => Promise<void>;
  /** Disable R2 background sync and return to local-only mode. */
  disableR2Sync: () => Promise<void>;
  /** Manually flush the pending sync queue to R2. */
  syncR2Now: () => Promise<void>;
  /** Re-attach R2 token and restart background sync after reload in local+r2 mode. */
  reconnectR2Sync: (token: string) => Promise<void>;

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

// ─── R2 background sync ────────────────────────────────────────────────────────

/** Module-level cleanup handle for online listener + periodic flush timer. */
let _r2SyncCleanup: (() => void) | null = null;

/**
 * Wire up an 'online' event listener and a 60-second periodic timer that both
 * flush the R2 queue. Replaces any previous listener set. Returns the cleanup
 * function (cancel timer + remove listener).
 */
function startR2BackgroundSync(userId: number, getToken: () => string | null): () => void {
  // Cancel any previous sync listeners before installing new ones.
  _r2SyncCleanup?.();

  const flush = () => {
    const token = getToken();
    if (!token) return;
    flushR2Queue(userId, token).catch(() => {});
  };

  window.addEventListener('online', flush);
  const timer = setInterval(flush, 60_000);

  const cleanup = () => {
    window.removeEventListener('online', flush);
    clearInterval(timer);
  };
  _r2SyncCleanup = cleanup;
  return cleanup;
}

/** Stop background R2 sync (call on disconnect / disable). */
function stopR2BackgroundSync(): void {
  _r2SyncCleanup?.();
  _r2SyncCleanup = null;
}

// ─── R2 encryption helpers ────────────────────────────────────────────────────

/**
 * Encrypt metadata + tasks as JSON then enqueue both as encrypted blobs.
 * The encryption key is the vault's AES-256-GCM key so the server never sees
 * plaintext metadata. Flush is triggered by the caller.
 */
async function enqueueEncryptedMetaAndTasks(
  userId: number,
  encKey: CryptoKey,
  meta: Record<string, unknown>,
  tasks: Record<string, unknown>,
): Promise<void> {
  const [encMeta, encTasks] = await Promise.all([
    encryptContent(JSON.stringify(meta), encKey),
    encryptContent(JSON.stringify(tasks), encKey),
  ]);
  await enqueueR2Op(userId, { op: 'put-metadata', key: '.ballpoint-meta', content: encMeta });
  await enqueueR2Op(userId, { op: 'put-tasks',    key: '.ballpoint-tasks', content: encTasks });
}

/**
 * Fire-and-forget sync of current metadata + tasks to R2 (encrypted).
 * Reads the latest store state, no-op when R2 sync is not active.
 */
function syncMetaAndTasksToR2(): void {
  const { r2Token, storageMode, r2EncryptionKey, userId, metadata, tasks } = useNotesStore.getState();
  if ((storageMode === 'r2' || storageMode === 'local+r2') && r2Token && r2EncryptionKey && userId) {
    enqueueEncryptedMetaAndTasks(userId, r2EncryptionKey, metadata as Record<string, unknown>, tasks as Record<string, unknown>)
      .then(() => flushR2Queue(userId, r2Token))
      .catch(() => {});
  }
}

// ─── Shared vault init helpers ──────────────────────────────────────────────────

type VaultData = {
  notes: NoteFile[];
  metadata: MetadataMap;
  tasks: TaskMap;
  isVaultEncrypted: boolean;
};

async function loadVaultData(
  handle: FileSystemDirectoryHandle,
  userId: number,
): Promise<VaultData> {
  const [rawFiles, meta, tasks, keyFile] = await Promise.all([
    scanFolder(handle),
    loadAllMetadata(userId),
    loadAllTasks(userId),
    readVaultFile(handle, VAULT_KEY_FILENAME),
  ]);
  return {
    notes: mergeWithMeta(rawFiles, meta),
    metadata: meta,
    tasks,
    isVaultEncrypted: keyFile !== null,
  };
}

function finishVaultInit(
  handle: FileSystemDirectoryHandle,
  data: VaultData,
  userId: number,
  extra: Record<string, unknown> = {},
): void {
  useNotesStore.setState({
    vaultHandle: handle,
    notes: data.notes,
    metadata: data.metadata,
    tasks: data.tasks,
    isVaultEncrypted: data.isVaultEncrypted,
    encryptionKey: null,
    isLoading: false,
    ...extra,
  });
  scanFolderSizes(handle).then(noteSizes => useNotesStore.setState({ noteSizes })).catch(() => {});
  if (!data.isVaultEncrypted) {
    const { selectNote } = useNotesStore.getState();
    const lastId = localStorage.getItem(activeNoteKey(userId));
    if (lastId && data.notes.find(n => n.id === lastId)) {
      selectNote(lastId);
    } else {
      const first = data.notes.find(n => n.status === 'active');
      if (first) selectNote(first.id);
    }
    buildFullTaskIndex(userId, data.notes, data.tasks, null)
      .then(tasks => useNotesStore.setState({ tasks }))
      .catch(() => {});
  }
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
  sessionUnlockedIds: new Set<string>(),

  syncStatus: 'idle',
  syncError: null,
  lastSyncRecord: null,
  syncHistory: [],
  walletAddress: null,
  hasLighthouseKey: false,
  syncEncryptionMode: SYNC_ENCRYPTION_MODE,

  storageMode: 'local' as 'local' | 'r2' | 'local+r2',
  r2Mode: false,
  r2Token: null,
  r2EncryptionKey: null,
  r2Status: 'idle',
  r2Error: null,
  r2LastSynced: null,
  r2Configured: false,
  r2PendingCount: 0,

  init: async (userId) => {
    set({ isLoading: true, userId });
    applyTheme(get().theme, get().accentColor);

    // Subscribe to R2 pending queue count changes
    onR2PendingCountChange(count => set({ r2PendingCount: count }));

    // If user was previously using R2 cloud vault only, restore that state and wait for password
    const wasR2 = localStorage.getItem('ballpoint-r2-mode') === '1';
    if (wasR2) {
      const status = await getR2Status().catch(() => ({ configured: false, bucket: '' }));
      await initR2Queue(userId);
      set({ isLoading: false, r2Mode: true, r2Configured: status.configured, storageMode: 'r2' });
      return;
    }

    // If local+r2 dual mode was enabled previously, note it for after vault loads
    const wasLocalPlusR2 = localStorage.getItem('ballpoint-r2-sync') === '1';
    if (wasLocalPlusR2) {
      await initR2Queue(userId);
    }

    const handle = await loadVault(userId);
    if (handle) {
      const data = await loadVaultData(handle, userId);
      finishVaultInit(handle, data, userId, {
        storageMode: wasLocalPlusR2 ? 'local+r2' : 'local',
        r2Mode: wasLocalPlusR2,
      });
    } else {
      set({ isLoading: false });
    }
  },

  reset: () => set({
    userId: null, vaultHandle: null, proxyVault: null, proxyContent: {}, notes: [], metadata: {}, tasks: {},
    activeNoteId: null, activeContent: '', isDirty: false, isLoading: false, searchQuery: '',
    encryptionKey: null, isVaultEncrypted: false, noteSizes: {}, sessionUnlockedIds: new Set<string>(),
    storageMode: 'local' as const, r2Mode: false, r2Token: null, r2EncryptionKey: null, r2PendingCount: 0,
    r2Status: 'idle' as const, r2Error: null, r2LastSynced: null,
  }),

  openNewVault: async (userId) => {
    const handle = await openVault(userId);
    if (!handle) return;
    set({ isLoading: true });
    const data = await loadVaultData(handle, userId);
    finishVaultInit(handle, data, userId);
  },

  openVaultFromHandle: async (userId, handle) => {
    // Best-effort permission request — already granted by the parent in most cases
    try {
      const perm = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
    } catch { /* parent may have pre-granted; proceed */ }

    set({ isLoading: true });
    await saveVaultHandle(userId, handle);
    const data = await loadVaultData(handle, userId);
    finishVaultInit(handle, data, userId);
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
    localStorage.removeItem('ballpoint-r2-mode');
    set({
      vaultHandle: null, proxyVault: null, proxyContent: {}, notes: [], metadata: {}, tasks: {},
      activeNoteId: null, activeContent: '', isDirty: false, encryptionKey: null, isVaultEncrypted: false, noteSizes: {}, sessionUnlockedIds: new Set<string>(),
      r2Mode: false, r2Token: null, r2Status: 'idle', r2Error: null,
    });
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
      const proxyBytes = new TextEncoder().encode(activeContent).length;
      set(s => ({ proxyContent: { ...s.proxyContent, [activeNoteId]: activeContent }, isDirty: false, noteSizes: { ...s.noteSizes, [activeNoteId]: proxyBytes } }));
      if (proxyVault !== '__r2_cloud__') {
        notifyParent({ type: 'ballpoint:write-file', name: activeNoteId, content: activeContent });
      }
      get().syncNoteTasks(activeNoteId, note.title, activeContent).catch(() => {});
      get().markPendingUpload(activeNoteId).catch(() => {});
      // R2 mode: encrypt then enqueue + flush
      const { r2Token, encryptionKey: eKey } = get();
      if (proxyVault === '__r2_cloud__' && r2Token && eKey) {
        set({ r2Status: 'syncing' });
        encryptContent(activeContent, eKey)
          .then(async enc => {
            await enqueueR2Op(userId, { op: 'put-note', key: activeNoteId, content: enc });
            return flushR2Queue(userId, r2Token);
          })
          .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
          .catch(err => set({ r2Error: (err as Error).message, r2Status: 'error' }));
      }
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
    // local+r2: also enqueue to cloud (queue is flushed by syncR2Now / background timer)
    const { storageMode: sm, r2Token: rt2, r2EncryptionKey: r2ek2 } = get();
    if (sm === 'local+r2' && rt2 && r2ek2) {
      encryptContent(activeContent, r2ek2)
        .then(enc => enqueueR2Op(userId, { op: 'put-note', key: activeNoteId, content: enc }))
        .then(() => flushR2Queue(userId, rt2))
        .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
        .catch(() => set({ r2Status: 'error', r2Error: 'Note queued for next sync' }));
    }
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
      const safe = finalTitle.replace(/[/\\?%*:|"<>]/g, '-');
      const filename = `${safe}.md`;
      const meta = await updateNoteMeta(userId, filename, { status: 'active', remoteStatus: 'pendingUpload' });
      set(s => ({ proxyContent: { ...s.proxyContent, [filename]: '' }, metadata: meta }));
      if (proxyVault !== '__r2_cloud__') {
        notifyParent({ type: 'ballpoint:create-file', name: filename, content: '' });
      }
      // R2 mode: enqueue empty note then flush
      const { r2Token, r2EncryptionKey: r2eKey } = get();
      if (proxyVault === '__r2_cloud__' && r2Token && r2eKey) {
        encryptContent('', r2eKey)
          .then(async enc => {
            await enqueueR2Op(userId!, { op: 'put-note', key: filename, content: enc });
            return flushR2Queue(userId!, r2Token);
          })
          .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
          .catch(err => set({ r2Error: (err as Error).message, r2Status: 'error' }));
      }
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
      const currentContent = get().proxyContent[id] ?? '';
      set(s => {
        const updated = { ...s.proxyContent };
        updated[newName] = currentContent;
        delete updated[id];
        return { proxyContent: updated };
      });
      if (proxyVault !== '__r2_cloud__') {
        notifyParent({ type: 'ballpoint:rename-file', oldName: id, newName, content: currentContent });
      }
      // R2 mode: enqueue put-new + delete-old, then flush
      const { r2Token, encryptionKey: eKey, userId: uid } = get();
      if (proxyVault === '__r2_cloud__' && r2Token && eKey && uid) {
        encryptContent(currentContent, eKey)
          .then(async enc => {
            await enqueueR2Op(uid, { op: 'put-note', key: newName, content: enc });
            await enqueueR2Op(uid, { op: 'delete-note', key: id });
            return flushR2Queue(uid, r2Token);
          })
          .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
          .catch(err => set({ r2Error: (err as Error).message, r2Status: 'error' }));
      }
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
    const { tasks, r2Token: rt3, storageMode: sm3 } = get();
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

    syncMetaAndTasksToR2();

    if (activeNoteId === id && userId) {
      localStorage.setItem(activeNoteKey(userId), resolvedNewName);
      set({ activeNoteId: resolvedNewName });
    }
  },

  trashNote: async (id) => {
    const { userId, metadata, r2Token: rt6, storageMode: sm6 } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { status: 'trashed', trashedAt: Date.now() }, { ...metadata });
    set({ metadata: newMeta });
    await get().refreshNotes();

    // Remove tasks for trashed note
    const { tasks } = get();
    const newTasks = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.noteId !== id));
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    syncMetaAndTasksToR2();

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
      if (proxyVault !== '__r2_cloud__') {
        notifyParent({ type: 'ballpoint:delete-file', name: id });
      }
      // R2 mode: enqueue delete then flush
      const { r2Token, userId: uid } = get();
      if (proxyVault === '__r2_cloud__' && r2Token && uid) {
        enqueueR2Op(uid, { op: 'delete-note', key: id })
          .then(() => flushR2Queue(uid, r2Token))
          .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
          .catch(err => set({ r2Error: (err as Error).message }));
      }
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
    const { tasks, r2Token: rt4, storageMode: sm4 } = get();
    const newTasks = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.noteId !== id));
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });

    syncMetaAndTasksToR2();

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
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  togglePinned: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const current = metadata[id]?.isPinned ?? false;
    const newMeta = await updateNoteMeta(userId, id, { isPinned: !current }, { ...metadata });
    set({ metadata: newMeta });
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  lockNote: async (id, password) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    const lockHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const newMeta = await updateNoteMeta(userId, id, { locked: true, lockHash }, { ...metadata });
    set({ metadata: newMeta });
    // Remove from session-unlocked set
    const next = new Set(get().sessionUnlockedIds);
    next.delete(id);
    set({ sessionUnlockedIds: next });
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  removeLock: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { locked: false, lockHash: undefined }, { ...metadata });
    set({ metadata: newMeta });
    const next = new Set(get().sessionUnlockedIds);
    next.delete(id);
    set({ sessionUnlockedIds: next });
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  sessionUnlock: (id) => {
    const next = new Set(get().sessionUnlockedIds);
    next.add(id);
    set({ sessionUnlockedIds: next });
  },

  sessionLock: (id) => {
    const next = new Set(get().sessionUnlockedIds);
    next.delete(id);
    set({ sessionUnlockedIds: next });
  },

  setNoteStatus: async (id, status) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { status }, { ...metadata });
    set({ metadata: newMeta });
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  setTags: async (id, tags) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { tags }, { ...metadata });
    set({ metadata: newMeta });
    syncMetaAndTasksToR2();
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
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  dismissReminder: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { reminderStatus: 'dismissed' }, { ...metadata });
    set({ metadata: newMeta });
    syncMetaAndTasksToR2();
    await get().refreshNotes();
  },

  fireReminder: async (id) => {
    const { userId, metadata } = get();
    if (!userId) return;
    const newMeta = await updateNoteMeta(userId, id, { reminderStatus: 'fired' }, { ...metadata });
    set({ metadata: newMeta });
    syncMetaAndTasksToR2();
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
    const { userId, tasks, activeNoteId, activeContent, notes, encryptionKey, proxyVault, proxyContent, r2Token } = get();
    if (!userId) return;
    const task = tasks[taskId];
    if (!task) return;

    const note = notes.find(n => n.id === task.noteId);
    if (!note) return;

    const newCompleted = !task.completed;

    // Read content from memory (active note, proxy/R2 mode) or from disk
    let content: string;
    if (activeNoteId === task.noteId) {
      content = activeContent;
    } else if (proxyVault !== null) {
      content = proxyContent[task.noteId] ?? '';
    } else {
      const raw = await readNote(note.handle);
      content = (isEncrypted(raw) && encryptionKey)
        ? await decryptContent(raw, encryptionKey)
        : raw;
    }
    const newContent = toggleTaskInContent(content, task.lineIndex, newCompleted);

    // Save content back
    if (proxyVault !== null) {
      const proxyBytes = new TextEncoder().encode(newContent).length;
      set(s => ({ proxyContent: { ...s.proxyContent, [task.noteId]: newContent }, noteSizes: { ...s.noteSizes, [task.noteId]: proxyBytes } }));
      if (proxyVault !== '__r2_cloud__') {
        notifyParent({ type: 'ballpoint:write-file', name: task.noteId, content: newContent });
      }
      const { r2EncryptionKey: r2ekT } = get();
      if (proxyVault === '__r2_cloud__' && r2Token && r2ekT && userId) {
        encryptContent(newContent, r2ekT)
          .then(async enc => {
            await enqueueR2Op(userId, { op: 'put-note', key: task.noteId, content: enc });
            return flushR2Queue(userId, r2Token);
          })
          .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
          .catch(err => set({ r2Error: (err as Error).message }));
      }
    } else {
      const toSave = encryptionKey
        ? await encryptContent(newContent, encryptionKey)
        : newContent;
      await saveNote(note.handle, toSave);
    }

    // If toggled note is the open one, update editor content too
    if (activeNoteId === task.noteId) {
      set({ activeContent: newContent, isDirty: false });
    }

    await get().refreshNotes();
    await get().syncNoteTasks(task.noteId, note.title, newContent);
  },

  setTaskDueDate: async (taskId, dueDate) => {
    const { userId, tasks, r2Token: rt5, storageMode: sm5 } = get();
    if (!userId) return;
    const task = tasks[taskId];
    if (!task) return;
    const updated: Task = { ...task, dueDate: dueDate ?? undefined, updatedAt: Date.now() };
    const newTasks = { ...tasks, [taskId]: updated };
    await saveAllTasks(userId, newTasks);
    set({ tasks: newTasks });
    syncMetaAndTasksToR2();
  },

  createTaskNote: async (text = 'New task') => {
    const { vaultHandle, proxyVault, userId } = get();
    if ((!vaultHandle && proxyVault === null) || !userId) return;
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

    const { storageMode, userId: uid2 } = get();
    // In local+r2 mode, re-derive the R2 key from the locally cached key file
    // using the same password.  Works seamlessly when local and cloud passwords
    // are identical; r2EncryptionKey stays null otherwise (manual sync required).
    let r2KeyFromCache: CryptoKey | null = null;
    if (storageMode === 'local+r2' && uid2) {
      const cached = localStorage.getItem(`ballpoint-r2-key-${uid2}`);
      if (cached) {
        r2KeyFromCache = await openKeyFile(cached, password).catch(() => null);
      }
    }
    set({
      encryptionKey: key,
      ...(r2KeyFromCache ? { r2EncryptionKey: r2KeyFromCache } : {}),
    });

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
          if (proxyVault !== '__r2_cloud__') {
            notifyParent({ type: 'ballpoint:write-file', name: snap.id, content: snap.content });
          }
        }
        set({ proxyContent: updated });
        // R2 mode: upload each restored note to cloud
        if (proxyVault === '__r2_cloud__') {
          const { userId, r2Token, r2EncryptionKey } = get();
          if (userId && r2Token && r2EncryptionKey) {
            await Promise.allSettled(
              snapshots.map(async snap => {
                try {
                  const enc = await encryptContent(snap.content, r2EncryptionKey);
                  await enqueueR2Op(userId, { op: 'put-note', key: snap.id, content: enc });
                } catch { /* skip */ }
              })
            );
            flushR2Queue(userId, r2Token)
              .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
              .catch(() => {});
          }
        }
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

  // ── R2 cloud vault ────────────────────────────────────────────────────────

  checkR2Status: async () => {
    try {
      const status = await getR2Status();
      set({ r2Configured: status.configured });
    } catch {
      set({ r2Configured: false });
    }
  },

  openR2Vault: async (userId, token, password) => {
    set({ isLoading: true, r2Status: 'syncing', r2Error: null });
    try {
      const keyContent = await getR2Key(token);
      if (!keyContent) throw new Error('No cloud vault found. Set up a new cloud vault first.');
      const key = await openKeyFile(keyContent, password);
      if (!key) throw new Error('Incorrect vault password.');

      // Load notes + metadata + tasks from R2 in parallel
      const [noteList, cloudMetaJson, cloudTasksJson] = await Promise.all([
        listR2Notes(token),
        getR2Metadata(token),
        getR2Tasks(token),
      ]);

      // Decrypt all notes
      const proxyContent: Record<string, string> = {};
      const noteSizes: Record<string, number> = {};
      await Promise.allSettled(
        noteList.map(async info => {
          try {
            const enc = await getR2Note(token, info.key);
            const dec = isEncrypted(enc) ? await decryptContent(enc, key) : enc;
            proxyContent[info.key] = dec;
            noteSizes[info.key] = new TextEncoder().encode(dec).length;
          } catch { /* skip corrupted */ }
        })
      );

      // Merge metadata: R2 cloud takes precedence over local IDB.
      // Cloud blobs are AES-256-GCM encrypted — decrypt before parsing.
      const localMeta = await loadAllMetadata(userId);
      let cloudMeta: typeof localMeta = {};
      try {
        const metaPlain = isEncrypted(cloudMetaJson)
          ? await decryptContent(cloudMetaJson, key)
          : cloudMetaJson;
        cloudMeta = JSON.parse(metaPlain) as typeof localMeta;
      } catch { /* use local */ }
      const metadata = { ...localMeta, ...cloudMeta };

      // Merge tasks: R2 cloud takes precedence over local IDB.
      const localTasks = await loadAllTasks(userId);
      let cloudTasks: typeof localTasks = {};
      try {
        const tasksPlain = isEncrypted(cloudTasksJson)
          ? await decryptContent(cloudTasksJson, key)
          : cloudTasksJson;
        cloudTasks = JSON.parse(tasksPlain) as typeof localTasks;
      } catch { /* use local */ }
      const existingTasks = { ...localTasks, ...cloudTasks };

      const rawFiles = noteList
        .filter(info => proxyContent[info.key] !== undefined)
        .map(info => ({
          id: info.key,
          handle: fakeHandle(info.key),
          name: info.key,
          title: info.key.replace(/\.(md|txt)$/, ''),
          lastModified: info.lastModified,
        }));
      const notes = mergeWithMeta(rawFiles, metadata);

      await initR2Queue(userId);
      localStorage.setItem('ballpoint-r2-mode', '1');

      set({
        userId, vaultHandle: null, proxyVault: '__r2_cloud__', proxyContent,
        notes, metadata, tasks: existingTasks,
        activeNoteId: null, activeContent: '', isDirty: false,
        encryptionKey: key, r2EncryptionKey: key, isVaultEncrypted: true, noteSizes,
        isLoading: false, r2Mode: true, r2Token: token,
        r2Status: 'idle', r2Error: null, r2LastSynced: Date.now(), r2Configured: true,
        storageMode: 'r2',
      });

      const first = notes.find(n => n.status === 'active');
      if (first) get().selectNote(first.id);

      // Start background sync (online listener + periodic flush)
      startR2BackgroundSync(userId, () => get().r2Token);

      // Flush any pending queue operations (from when we were offline)
      flushR2Queue(userId, token).catch(() => {});

      buildFullTaskIndex(userId, notes, existingTasks, key, proxyContent)
        .then(tasks => set({ tasks }))
        .catch(() => {});
    } catch (err: unknown) {
      const e = err as Error;
      set({ isLoading: false, r2Status: 'error', r2Error: e.message ?? 'Failed to open cloud vault' });
      throw err;
    }
  },

  createR2Vault: async (userId, token, password) => {
    set({ isLoading: true, r2Status: 'syncing', r2Error: null });
    try {
      const { key, content: keyContent } = await createKeyFileContent(password);
      await putR2Key(token, keyContent);

      const metadata = await loadAllMetadata(userId);
      const existingTasks = await loadAllTasks(userId);

      await initR2Queue(userId);
      startR2BackgroundSync(userId, () => get().r2Token);
      localStorage.setItem('ballpoint-r2-mode', '1');

      set({
        userId, vaultHandle: null, proxyVault: '__r2_cloud__', proxyContent: {},
        notes: [], metadata, tasks: existingTasks,
        activeNoteId: null, activeContent: '', isDirty: false,
        encryptionKey: key, r2EncryptionKey: key, isVaultEncrypted: true, noteSizes: {},
        isLoading: false, r2Mode: true, r2Token: token,
        r2Status: 'idle', r2Error: null, r2LastSynced: Date.now(), r2Configured: true,
        storageMode: 'r2',
      });
    } catch (err: unknown) {
      const e = err as Error;
      set({ isLoading: false, r2Status: 'error', r2Error: e.message ?? 'Failed to create cloud vault' });
      throw err;
    }
  },

  disconnectR2Vault: async (userId) => {
    stopR2BackgroundSync();
    localStorage.removeItem('ballpoint-r2-mode');
    localStorage.removeItem('ballpoint-r2-sync');
    localStorage.removeItem(`ballpoint-r2-key-${userId}`);
    localStorage.removeItem(activeNoteKey(userId));
    await clearR2Queue(userId);
    set({
      vaultHandle: null, proxyVault: null, proxyContent: {}, notes: [], metadata: {}, tasks: {},
      activeNoteId: null, activeContent: '', isDirty: false,
      encryptionKey: null, isVaultEncrypted: false, noteSizes: {},
      storageMode: 'local', r2Mode: false, r2Token: null, r2EncryptionKey: null,
      r2Status: 'idle', r2Error: null, r2PendingCount: 0,
    });
  },

  // ── R2 local+r2 dual mode ─────────────────────────────────────────────────

  enableR2Sync: async (token, password) => {
    const { userId, vaultHandle, encryptionKey } = get();
    if (!userId || !vaultHandle) throw new Error('Open a local vault first to enable cloud sync.');
    set({ r2Status: 'syncing', r2Error: null });
    try {
      // Resolve the R2 vault key.  We always use the R2 password-derived key
      // for cloud payloads so that openR2Vault on any device can decrypt them
      // with the same password.  The key file content is cached in localStorage
      // so unlockVault can re-derive r2EncryptionKey after a page reload.
      let r2Key: CryptoKey;
      let r2KeyContent: string;
      const existing = await getR2Key(token);
      if (existing) {
        const opened = await openKeyFile(existing, password);
        if (!opened) throw new Error('Incorrect cloud vault password.');
        r2Key = opened;
        r2KeyContent = existing;
      } else {
        const { key: newKey, content: keyContent } = await createKeyFileContent(password);
        await putR2Key(token, keyContent);
        r2Key = newKey;
        r2KeyContent = keyContent;
      }

      // Cache key file locally so unlockVault can re-derive r2EncryptionKey
      // on reload using the same vault password (if passwords match).
      localStorage.setItem(`ballpoint-r2-key-${userId}`, r2KeyContent);

      await initR2Queue(userId);
      startR2BackgroundSync(userId, () => get().r2Token);
      localStorage.setItem('ballpoint-r2-sync', '1');

      set({
        storageMode: 'local+r2', r2Mode: true, r2Token: token,
        r2EncryptionKey: r2Key,
        r2Status: 'idle', r2Error: null, r2Configured: true,
      });

      // Initial sync: decrypt from local vault, re-encrypt with R2 key, upload
      const { notes } = get();
      await Promise.allSettled(
        notes
          .filter(n => n.status === 'active')
          .map(async n => {
            try {
              const { readNote: rn } = await import('./fileSystem');
              const raw = await rn(n.handle);
              const { isEncrypted: ie, decryptContent: dc } = await import('./crypto');
              const plain = (ie(raw) && encryptionKey) ? await dc(raw, encryptionKey) : raw;
              const enc = await encryptContent(plain, r2Key);
              await enqueueR2Op(userId, { op: 'put-note', key: n.id, content: enc });
            } catch { /* skip */ }
          })
      );

      // Queue metadata + tasks encrypted with the R2 key (same key openR2Vault uses)
      const { metadata, tasks: curTasks } = get();
      await enqueueEncryptedMetaAndTasks(
        userId,
        r2Key,
        metadata as Record<string, unknown>,
        curTasks as Record<string, unknown>,
      );

      flushR2Queue(userId, token)
        .then(() => set({ r2LastSynced: Date.now(), r2Status: 'idle', r2Error: null }))
        .catch(err => set({ r2Error: (err as Error).message, r2Status: 'error' }));
    } catch (err: unknown) {
      const e = err as Error;
      set({ r2Status: 'error', r2Error: e.message ?? 'Failed to enable cloud sync' });
      throw err;
    }
  },

  disableR2Sync: async () => {
    const { userId } = get();
    if (!userId) return;
    stopR2BackgroundSync();
    localStorage.removeItem('ballpoint-r2-sync');
    localStorage.removeItem(`ballpoint-r2-key-${userId}`);
    await clearR2Queue(userId);
    set({
      storageMode: 'local', r2Mode: false, r2Token: null, r2EncryptionKey: null,
      r2Status: 'idle', r2Error: null, r2PendingCount: 0,
    });
  },

  reconnectR2Sync: async (token) => {
    const { userId, storageMode } = get();
    if (!userId || storageMode !== 'local+r2') return;
    set({ r2Token: token });
    startR2BackgroundSync(userId, () => get().r2Token);
    flushR2Queue(userId, token).catch(() => {});
  },

  syncR2Now: async () => {
    const { userId, r2Token } = get();
    if (!userId || !r2Token) return;
    set({ r2Status: 'syncing', r2Error: null });
    try {
      const result = await flushR2Queue(userId, r2Token);
      set({
        r2Status: result.failed > 0 ? 'error' : 'idle',
        r2Error: result.failed > 0 ? `${result.failed} operation(s) failed — will retry` : null,
        r2LastSynced: result.flushed > 0 ? Date.now() : get().r2LastSynced,
      });
    } catch (err: unknown) {
      const e = err as Error;
      set({ r2Status: 'error', r2Error: e.message ?? 'Sync failed' });
    }
  },

  // ── UI ────────────────────────────────────────────────────────────────────

  setActiveSection: (section) => set({ activeSection: section, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('ballpoint-theme', newTheme); } catch { /* private browsing */ }
    applyTheme(newTheme, get().accentColor);
    set({ theme: newTheme });
  },

  setAccentColor: (color) => {
    try { localStorage.setItem('ballpoint-accent', color); } catch { /* private browsing */ }
    applyTheme(get().theme, color);
    set({ accentColor: color });
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

export function selectFilteredNotes(state: NotesState): NoteFile[] {
  const { notes, activeSection, searchQuery, proxyContent } = state;

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
    list = list.filter(n => {
      if (n.title.toLowerCase().includes(q)) return true;
      if (n.tags.some(t => t.toLowerCase().includes(q))) return true;
      // Also search note content when it's available in memory (cloud vault users)
      const content = proxyContent[n.id];
      if (content && content.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Pinned always float to top, then favorites, then rest
  const pinned    = list.filter(n => n.isPinned);
  const notPinned = list.filter(n => !n.isPinned);
  if (activeSection.type === 'all') {
    const favs    = notPinned.filter(n => n.isFavorite);
    const rest    = notPinned.filter(n => !n.isFavorite);
    list = [...pinned, ...favs, ...rest];
  } else {
    list = [...pinned, ...notPinned];
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
