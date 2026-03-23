import { create } from 'zustand';
import {
  openVault,
  loadVault,
  scanFolder,
  readNote,
  saveNote,
  createNote,
  deleteNote,
  renameNote,
  clearVault,
  NoteFile
} from './fileSystem';

interface NotesState {
  userId: number | null;
  vaultHandle: FileSystemDirectoryHandle | null;
  notes: NoteFile[];
  activeNoteId: string | null;
  activeContent: string;
  isDirty: boolean;
  isLoading: boolean;
  searchQuery: string;
  theme: 'light' | 'dark';

  // Actions
  init: (userId: number) => Promise<void>;
  reset: () => void;
  openNewVault: (userId: number) => Promise<void>;
  disconnectVault: (userId: number) => Promise<void>;
  refreshNotes: () => Promise<void>;
  selectNote: (id: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveActiveNote: () => Promise<void>;
  createNewNote: (title?: string) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  changeNoteTitle: (id: string, newTitle: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  toggleTheme: () => void;
}

const getInitialTheme = (): 'light' | 'dark' => {
  try {
    const stored = localStorage.getItem('notesnook-theme') as 'light' | 'dark' | null;
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

function activeNoteKey(userId: number) {
  return `notesnook-active-note-${userId}`;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  userId: null,
  vaultHandle: null,
  notes: [],
  activeNoteId: null,
  activeContent: '',
  isDirty: false,
  isLoading: true,
  searchQuery: '',
  theme: getInitialTheme(),

  init: async (userId: number) => {
    set({ isLoading: true, userId });
    const theme = get().theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');

    const handle = await loadVault(userId);
    if (handle) {
      const notes = await scanFolder(handle);
      set({ vaultHandle: handle, notes, isLoading: false });
      const lastActiveId = localStorage.getItem(activeNoteKey(userId));
      if (lastActiveId && notes.find(n => n.id === lastActiveId)) {
        get().selectNote(lastActiveId);
      } else if (notes.length > 0) {
        get().selectNote(notes[0].id);
      }
    } else {
      set({ isLoading: false });
    }
  },

  reset: () => {
    set({
      userId: null,
      vaultHandle: null,
      notes: [],
      activeNoteId: null,
      activeContent: '',
      isDirty: false,
      isLoading: false,
      searchQuery: '',
    });
  },

  openNewVault: async (userId: number) => {
    const handle = await openVault(userId);
    if (handle) {
      set({ isLoading: true });
      const notes = await scanFolder(handle);
      set({ vaultHandle: handle, notes, activeNoteId: null, activeContent: '', isDirty: false, isLoading: false });
      if (notes.length > 0) get().selectNote(notes[0].id);
    }
  },

  disconnectVault: async (userId: number) => {
    await clearVault(userId);
    localStorage.removeItem(activeNoteKey(userId));
    set({ vaultHandle: null, notes: [], activeNoteId: null, activeContent: '', isDirty: false });
  },

  refreshNotes: async () => {
    const handle = get().vaultHandle;
    if (handle) {
      const notes = await scanFolder(handle);
      set({ notes });
    }
  },

  selectNote: async (id: string) => {
    const state = get();
    if (state.isDirty && state.activeNoteId) await state.saveActiveNote();
    const note = state.notes.find(n => n.id === id);
    if (note && state.userId !== null) {
      const content = await readNote(note.handle);
      localStorage.setItem(activeNoteKey(state.userId), id);
      set({ activeNoteId: id, activeContent: content, isDirty: false });
    }
  },

  updateContent: (content: string) => set({ activeContent: content, isDirty: true }),

  saveActiveNote: async () => {
    const state = get();
    if (!state.activeNoteId || !state.vaultHandle) return;
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note) {
      await saveNote(note.handle, state.activeContent);
      set({ isDirty: false });
      await state.refreshNotes();
    }
  },

  createNewNote: async (title = 'Untitled Note') => {
    const state = get();
    if (!state.vaultHandle) return;
    if (state.isDirty && state.activeNoteId) await state.saveActiveNote();

    let finalTitle = title;
    let counter = 1;
    while (state.notes.some(n => n.title === finalTitle)) {
      finalTitle = `${title} ${counter}`;
      counter++;
    }

    const handle = await createNote(state.vaultHandle, finalTitle);
    await state.refreshNotes();
    await get().selectNote(handle.name);
  },

  removeNote: async (id: string) => {
    const state = get();
    if (!state.vaultHandle) return;
    await deleteNote(state.vaultHandle, id);
    await state.refreshNotes();
    const updatedNotes = get().notes;
    if (state.activeNoteId === id) {
      if (updatedNotes.length > 0) {
        get().selectNote(updatedNotes[0].id);
      } else {
        if (state.userId) localStorage.removeItem(activeNoteKey(state.userId));
        set({ activeNoteId: null, activeContent: '', isDirty: false });
      }
    }
  },

  changeNoteTitle: async (id: string, newTitle: string) => {
    const state = get();
    if (!state.vaultHandle || !newTitle.trim()) return;
    const note = state.notes.find(n => n.id === id);
    if (!note || note.title === newTitle) return;
    const newHandle = await renameNote(state.vaultHandle, note.handle, newTitle);
    await state.refreshNotes();
    if (state.activeNoteId === id && state.userId) {
      localStorage.setItem(activeNoteKey(state.userId), newHandle.name);
      set({ activeNoteId: newHandle.name });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('notesnook-theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    set({ theme: newTheme });
  },
}));
