import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useNotesStore } from "@/lib/store";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function CommandPalette({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void 
}) {
  const { notes, selectNote } = useNotesStore();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(true);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="border-b border-border px-3 pb-0">
         <CommandInput placeholder="Type a command or search notes..." className="border-none focus:ring-0 text-lg h-14" />
      </div>
      <CommandList className="py-2 max-h-[60vh]">
        <CommandEmpty className="py-6 text-center text-muted-foreground">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
          No results found.
        </CommandEmpty>
        <CommandGroup heading="Your Notes" className="text-muted-foreground px-2">
          {notes.map((note) => (
            <CommandItem
              key={note.id}
              value={note.title}
              onSelect={() => runCommand(() => selectNote(note.id))}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer rounded-xl my-1 aria-selected:bg-primary/10 aria-selected:text-primary transition-colors"
            >
              <FileText className="w-4 h-4 opacity-70" />
              <span className="font-medium text-foreground">{note.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
