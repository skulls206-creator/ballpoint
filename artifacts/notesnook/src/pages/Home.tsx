import { useEffect, useRef, useState } from 'react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { WelcomeScreen } from '../components/WelcomeScreen';
import { Sidebar } from '../components/Sidebar';
import { NoteList } from '../components/NoteList';
import { Editor } from '../components/Editor';
import { CommandPalette } from '../components/CommandPalette';

export default function Home() {
  const { user } = useAuth();

  // Only subscribe to primitives that this component actually needs
  const vaultHandle  = useNotesStore(s => s.vaultHandle);
  const isLoading    = useNotesStore(s => s.isLoading);
  const init         = useNotesStore(s => s.init);
  const reset        = useNotesStore(s => s.reset);

  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    if (user) {
      init(user.id);
    } else {
      reset();
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut — use a ref so the handler never needs to be re-registered
  const vaultRef = useRef(vaultHandle);
  useEffect(() => { vaultRef.current = vaultHandle; }, [vaultHandle]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (vaultRef.current) useNotesStore.getState().createNewNote();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable — reads vault from ref

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="mt-3 text-xs text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  if (!vaultHandle) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
        <WelcomeScreen />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
      <NoteList />
      <Editor />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
