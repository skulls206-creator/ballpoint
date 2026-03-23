import { create } from 'zustand';
import {
  openVault, loadVault, scanFolder, readNote, saveNote,
  createNote, deleteNote, renameNote, clearVault, NoteFile,
} from './fileSystem';
import {
  loadAllMetadata, saveAllMetadata, updateNoteMeta, removeNoteMeta,
  getAllTags, MetadataMap, NoteStatus, AccentColor, DEFAULT_META,
} from './metadata';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SidebarSection =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'tag'; tag: string };

interface NotesState {
  userId: number | null;
  vaultHandle: FileSystemDirectoryHandle | null;
  /** All notes merged with metadata */
  notes: NoteFile[];
  metadata: MetadataMap;
  activeNoteId: string | null;
  activeContent: string;
  isDirty: boolean;
  isLoading: boolean;
  searchQuery: string;
  activeSection: SidebarSection;
  theme: 'light' | 'dark';
  accentColor: AccentColor;

  // Vault
  init: (userId: number) => Promise<void>;
  reset: () => void;
  openNewVault: (userId: number) => Promise<void>;
  disconnectVault: (userId: number) => Promise<void>;
  refreshNotes: () => Promise<void>;

  // Notes CRUD
  selectNote: (id: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveActiveNote: () => Promise<void>;
  createNewNote: (title?: string) => Promise<void>;
  renameNote: (id: string, newTitle: string) => Promise<void>;
  /** Moves to trash — doesn't delete from disk */
  trashNote: (id: string) => Promise<void>;
  /** Restores from trash/archive to active */
  restoreNote: (id: string) => Promise<void>;
  /** Permanently removes from disk + metadata */
  permanentlyDeleteNote: (id: string) => Promise<void>;

  // Metadata actions
  toggleFavorite: (id: string) => Promise<void>;
  setNoteStatus: (id: string, status: NoteStatus) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  setReminder: (id: string, reminderTime: string | null) => Promise<void>;
  dismissReminder: (id: string) => Promise<void>;
  fireReminder: (id: string) => Promise<void>;

  // UI
  setActiveSection: (section: SidebarSection) => void;
  setSearchQuery: (query: string) => void;
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function activeNoteKey(userId: number) { return `localnotes-active-${userId}`; }

function getInitialTheme(): 'light' | 'dark' {
  try {
    const s = localStorage.getItem('localnotes-theme') as 'light' | 'dark' | null;
    if (s) return s;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'dark'; }
}

function getInitialAccent(): AccentColor {
  return (localStorage.getItem('localnotes-accent') as AccentColor) ?? 'violet';
}

function applyTheme(theme: 'light' | 'dark', accent: AccentColor) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  const accents: AccentColor[] = ['violet', 'blue', 'teal', 'green', 'rose', 'orange'];
  accents.forEach(a => root.classList.remove(`accent-${a}`));
  root.classList.add(`accent-${accent}`);
}

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

// ─── Store ───────────────────────────────────────────────────────────────────

export const useNotesStore = create<NotesState>((set, get) => ({
  userId: null,
  vaultHandle: null,
  notes: [],
  metadata: {},
  activeNoteId: null,
  activeContent: '',
  isDirty: false,
  isLoading: true,
  searchQuery: '',
  activeSection: { type: 'all' },
  theme: getInitialTheme(),
  accentColor: getInitialAccent(),

  init: async (userId) => {
    set({ isLoading: true, userId });
    applyTheme(get().theme, get().accentColor);

    const handle = await loadVault(userId);
    if (handle) {
      const [rawFiles, meta] = await Promise.all([scanFolder(handle), loadAllMetadata(userId)]);
      const notes = mergeWithMeta(rawFiles, meta);
      set({ vaultHandle: handle, notes, metadata: meta, isLoading: false });

      const lastId = localStorage.getItem(activeNoteKey(userId));
      if (lastId && notes.find(n => n.id === lastId)) {
        get().selectNote(lastId);
      } else {
        const first = notes.find(n => n.status === 'active');
        if (first) get().selectNote(first.id);
      }
    } else {
      set({ isLoading: false });
    }
  },

  reset: () => set({
    userId: null, vaultHandle: null, notes: [], metadata: {},
    activeNoteId: null, activeContent: '', isDirty: false, isLoading: false, searchQuery: '',
  }),

  openNewVault: async (userId) => {
    const handle = await openVault(userId);
    if (!handle) return;
    set({ isLoading: true });
    const [rawFiles, meta] = await Promise.all([scanFolder(handle), loadAllMetadata(userId)]);
    const notes = mergeWithMeta(rawFiles, meta);
    set({ vaultHandle: handle, notes, metadata: meta, activeNoteId: null, activeContent: '', isDirty: false, isLoading: false });
    const first = notes.find(n => n.status === 'active');
    if (first) get().selectNote(first.id);
  },

  disconnectVault: async (userId) => {
    await clearVault(userId);
    localStorage.removeItem(activeNoteKey(userId));
    set({ vaultHandle: null, notes: [], metadata: {}, activeNoteId: null, activeContent: '', isDirty: false });
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
      const content = await readNote(note.handle);
      localStorage.setItem(activeNoteKey(state.userId), id);
      set({ activeNoteId: id, activeContent: content, isDirty: false });
    }
  },

  updateContent: (content) => set({ activeContent: content, isDirty: true }),

  saveActiveNote: async () => {
    const { activeNoteId, vaultHandle, notes, activeContent } = get();
    if (!activeNoteId || !vaultHandle) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
      await saveNote(note.handle, activeContent);
      set({ isDirty: false });
      await get().refreshNotes();
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
    // Initialize metadata as active
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

    // Move metadata to new key
    const oldMeta = metadata[id];
    const newMeta = { ...metadata };
    if (oldMeta) {
      newMeta[newHandle.name] = oldMeta;
      delete newMeta[id];
    }
    await saveAllMetadata(userId, newMeta);
    set({ metadata: newMeta });
    await get().refreshNotes();

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
    // If active note was trashed, pick another
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

  setActiveSection: (section) => set({ activeSection: section, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('localnotes-theme', newTheme);
    applyTheme(newTheme, get().accentColor);
    set({ theme: newTheme });
  },

  setAccentColor: (color) => {
    localStorage.setItem('localnotes-accent', color);
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
    }
  });

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  // Favorites pinned to top in 'all' view
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
    all: state.notes.filter(n => n.status === 'active').length,
    favorites: state.notes.filter(n => n.status === 'active' && n.isFavorite).length,
    archive: state.notes.filter(n => n.status === 'archived').length,
    trash: state.notes.filter(n => n.status === 'trashed').length,
  };
}
