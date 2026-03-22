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
  vaultHandle: FileSystemDirectoryHandle | null;
  notes: NoteFile[];
  activeNoteId: string | null;
  activeContent: string;
  isDirty: boolean;
  isLoading: boolean;
  searchQuery: string;
  theme: 'light' | 'dark';
  
  // Actions
  init: () => Promise<void>;
  openNewVault: () => Promise<void>;
  disconnectVault: () => Promise<void>;
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

export const useNotesStore = create<NotesState>((set, get) => ({
  vaultHandle: null,
  notes: [],
  activeNoteId: null,
  activeContent: '',
  isDirty: false,
  isLoading: true,
  searchQuery: '',
  theme: (localStorage.getItem('notesnook-theme') as 'light' | 'dark') || 
         (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),

  init: async () => {
    set({ isLoading: true });
    
    // Apply theme
    const theme = get().theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');

    const handle = await loadVault();
    if (handle) {
      const notes = await scanFolder(handle);
      set({ vaultHandle: handle, notes, isLoading: false });
      
      const lastActiveId = localStorage.getItem('notesnook-active-note');
      if (lastActiveId && notes.find(n => n.id === lastActiveId)) {
        get().selectNote(lastActiveId);
      } else if (notes.length > 0) {
        get().selectNote(notes[0].id);
      }
    } else {
      set({ isLoading: false });
    }
  },

  openNewVault: async () => {
    const handle = await openVault();
    if (handle) {
      set({ isLoading: true });
      const notes = await scanFolder(handle);
      set({ vaultHandle: handle, notes, activeNoteId: null, activeContent: '', isDirty: false, isLoading: false });
      if (notes.length > 0) {
        get().selectNote(notes[0].id);
      }
    }
  },

  disconnectVault: async () => {
    await clearVault();
    localStorage.removeItem('notesnook-active-note');
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
    if (state.isDirty && state.activeNoteId) {
      await state.saveActiveNote(); // Auto-save previous before switching
    }

    const note = state.notes.find(n => n.id === id);
    if (note) {
      const content = await readNote(note.handle);
      localStorage.setItem('notesnook-active-note', id);
      set({ activeNoteId: id, activeContent: content, isDirty: false });
    }
  },

  updateContent: (content: string) => {
    set({ activeContent: content, isDirty: true });
  },

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

    if (state.isDirty && state.activeNoteId) {
      await state.saveActiveNote();
    }

    const baseTitle = title;
    let finalTitle = baseTitle;
    let counter = 1;
    
    // Simple deduplication
    while (state.notes.some(n => n.title === finalTitle)) {
      finalTitle = `${baseTitle} ${counter}`;
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
        localStorage.removeItem('notesnook-active-note');
        set({ activeNoteId: null, activeContent: '', isDirty: false });
      }
    }
  },

  changeNoteTitle: async (id: string, newTitle: string) => {
    const state = get();
    if (!state.vaultHandle) return;
    if (!newTitle.trim()) return;

    const note = state.notes.find(n => n.id === id);
    if (!note || note.title === newTitle) return;

    const newHandle = await renameNote(state.vaultHandle, note.handle, newTitle);
    await state.refreshNotes();
    
    if (state.activeNoteId === id) {
      localStorage.setItem('notesnook-active-note', newHandle.name);
      set({ activeNoteId: newHandle.name });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('notesnook-theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    set({ theme: newTheme });
  }
}));
