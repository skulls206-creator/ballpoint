import { useEffect, useState } from "react";
import { useNotesStore } from "@/lib/store";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { Sidebar } from "@/components/Sidebar";
import { NoteList } from "@/components/NoteList";
import { Editor } from "@/components/Editor";
import { CommandPalette } from "@/components/CommandPalette";

export default function Home() {
  const { vaultHandle, init, isLoading, createNewNote } = useNotesStore();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (vaultHandle) createNewNote();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        if (vaultHandle) setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vaultHandle, createNewNote]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        <p className="mt-4 text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
      </div>
    );
  }

  if (!vaultHandle) {
    return <WelcomeScreen />;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 text-foreground">
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
      <NoteList />
      <Editor />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
