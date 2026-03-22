import { useState } from "react";
import { format } from "date-fns";
import { FileText, MoreVertical, Trash2, Edit2 } from "lucide-react";
import { useNotesStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export function NoteList() {
  const { notes, activeNoteId, selectNote, searchQuery, setSearchQuery, removeNote, changeNoteTitle } = useNotesStore();
  
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRenameSubmit = () => {
    if (renamingId && renameValue.trim()) {
      changeNoteTitle(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="w-[300px] hidden lg:flex flex-col h-screen border-r border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
      <div className="p-4 border-b border-border/50 bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <Input 
          placeholder="Search notes..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-background/50 border-border/50 rounded-xl h-10 shadow-inner"
        />
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {filteredNotes.map((note) => {
              const isActive = activeNoteId === note.id;
              
              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={note.id}
                  onClick={() => selectNote(note.id)}
                  className={`
                    group relative p-3 rounded-xl cursor-pointer transition-all duration-200
                    ${isActive 
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' 
                      : 'hover:bg-accent hover:text-accent-foreground text-foreground/80'}
                  `}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate flex items-center gap-2">
                        <FileText className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}`} />
                        {note.title}
                      </h4>
                      <div className={`text-xs mt-1 truncate ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {format(new Date(note.lastModified), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className={`
                          p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity
                          ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-background'}
                        `}>
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 rounded-xl">
                        <DropdownMenuItem 
                          onClick={(e) => { e.stopPropagation(); setRenamingId(note.id); setRenameValue(note.title); }}
                          className="cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={(e) => { e.stopPropagation(); removeNote(note.id); }}
                          className="cursor-pointer text-destructive focus:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {filteredNotes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground flex flex-col items-center">
              <FileText className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm font-medium">No notes found</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!renamingId} onOpenChange={(open) => !open && setRenamingId(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Rename Note</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              value={renameValue} 
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
              className="rounded-xl h-12"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenamingId(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleRenameSubmit} className="rounded-xl bg-primary text-primary-foreground">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
