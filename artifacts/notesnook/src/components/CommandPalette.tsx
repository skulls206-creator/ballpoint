import { useEffect, useMemo } from 'react';
import { FileText, Star, Archive, Search } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import {
  CommandDialog, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from './ui/command';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Use stable primitive selectors — never return new array references from Zustand
  const notes          = useNotesStore(s => s.notes);
  const selectNote     = useNotesStore(s => s.selectNote);
  const setActiveSection = useNotesStore(s => s.setActiveSection);

  // Derive filtered lists locally
  const activeNotes   = useMemo(() => notes.filter(n => n.status === 'active'), [notes]);
  const favoriteNotes = useMemo(() => notes.filter(n => n.status === 'active' && n.isFavorite), [notes]);
  const archivedNotes = useMemo(() => notes.filter(n => n.status === 'archived'), [notes]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpenChange(true); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpenChange]);

  const run = (fn: () => void) => { onOpenChange(false); fn(); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="border-b border-border">
        <CommandInput placeholder="Search notes, tags, commands..." className="border-0 h-10 text-sm" />
      </div>
      <CommandList className="max-h-[60vh]">
        <CommandEmpty className="py-8 text-center text-muted-foreground">
          <Search size={28} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">No results found</p>
        </CommandEmpty>

        {favoriteNotes.length > 0 && (
          <CommandGroup heading="Favorites">
            {favoriteNotes.map(note => (
              <CommandItem key={note.id} value={`fav-${note.title}-${note.id}`}
                onSelect={() => run(() => { setActiveSection({ type: 'all' }); selectNote(note.id); })}
                className="flex items-center gap-2 cursor-pointer py-1.5">
                <Star size={12} className="text-primary fill-primary shrink-0" />
                <span className="text-sm">{note.title}</span>
                {note.tags.length > 0 && (
                  <div className="ml-auto flex gap-1">
                    {note.tags.slice(0, 2).map(t => (
                      <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary/70">{t}</span>
                    ))}
                  </div>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Notes">
          {activeNotes.map(note => (
            <CommandItem key={note.id} value={`note-${note.title}-${note.id}`}
              onSelect={() => run(() => { setActiveSection({ type: 'all' }); selectNote(note.id); })}
              className="flex items-center gap-2 cursor-pointer py-1.5">
              <FileText size={12} className="text-muted-foreground shrink-0" />
              <span className="text-sm">{note.title}</span>
              {note.tags.length > 0 && (
                <div className="ml-auto flex gap-1">
                  {note.tags.slice(0, 2).map(t => (
                    <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary/70">{t}</span>
                  ))}
                </div>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {archivedNotes.length > 0 && (
          <CommandGroup heading="Archive">
            {archivedNotes.map(note => (
              <CommandItem key={note.id} value={`arch-${note.title}-${note.id}`}
                onSelect={() => run(() => { setActiveSection({ type: 'archive' }); selectNote(note.id); })}
                className="flex items-center gap-2 cursor-pointer py-1.5 opacity-70">
                <Archive size={12} className="text-muted-foreground shrink-0" />
                <span className="text-sm">{note.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
