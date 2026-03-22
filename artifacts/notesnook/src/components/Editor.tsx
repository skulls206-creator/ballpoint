import { useEffect, useState, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { format } from "date-fns";
import { Save, AlertCircle, Maximize2, Minimize2 } from "lucide-react";
import { useNotesStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Editor() {
  const { 
    activeNoteId, 
    notes, 
    activeContent, 
    updateContent, 
    saveActiveNote, 
    isDirty,
    changeNoteTitle
  } = useNotesStore();

  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const activeNote = notes.find(n => n.id === activeNoteId);

  // Sync title input with active note
  useEffect(() => {
    if (activeNote) {
      setTitleValue(activeNote.title);
    }
  }, [activeNoteId, activeNote?.title]);

  const handleTitleBlur = () => {
    if (activeNote && titleValue.trim() && titleValue !== activeNote.title) {
      changeNoteTitle(activeNote.id, titleValue.trim());
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleInputRef.current?.blur();
    }
  };

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveNote]);

  if (!activeNoteId || !activeNote) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground">
        <div className="w-24 h-24 mb-6 rounded-full bg-muted/50 flex items-center justify-center ring-1 ring-border shadow-inner">
          <AlertCircle className="w-10 h-10 opacity-50" />
        </div>
        <p className="text-lg font-medium">No note selected</p>
        <p className="text-sm opacity-70 mt-1">Select a note from the sidebar or create a new one.</p>
      </div>
    );
  }

  const rawHtml = marked(activeContent || '');
  const cleanHtml = DOMPurify.sanitize(typeof rawHtml === 'string' ? rawHtml : rawHtml.toString());

  return (
    <div className="flex-1 flex flex-col bg-background h-screen overflow-hidden">
      {/* Top Bar */}
      <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/30 backdrop-blur-sm z-10 shrink-0">
        <div className="flex-1 min-w-0 pr-4">
          <input 
            ref={titleInputRef}
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="w-full bg-transparent border-none text-xl font-display font-semibold outline-none focus:ring-0 placeholder:text-muted-foreground/50 truncate text-foreground"
            placeholder="Untitled Note"
          />
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
            <span>Last modified: {format(new Date(activeNote.lastModified), 'MMM d, yyyy h:mm a')}</span>
            {isDirty && <span className="text-primary font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span> Unsaved changes</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setIsPreviewMode(!isPreviewMode)}
                className="rounded-xl lg:hidden"
              >
                {isPreviewMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle Preview</TooltipContent>
          </Tooltip>

          <Button 
            onClick={saveActiveNote} 
            disabled={!isDirty}
            className={`rounded-xl transition-all duration-300 ${isDirty ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-muted text-muted-foreground'}`}
          >
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </header>

      {/* Editor/Preview Split */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className={`flex-1 flex flex-col transition-all duration-300 ${isPreviewMode ? 'hidden lg:flex' : 'flex'}`}>
          <textarea
            value={activeContent}
            onChange={(e) => updateContent(e.target.value)}
            className="flex-1 w-full bg-transparent p-6 md:p-8 resize-none outline-none text-foreground font-mono text-sm leading-relaxed"
            placeholder="Start writing..."
            spellCheck={false}
          />
        </div>

        <div className={`flex-1 border-l border-border bg-card/10 transition-all duration-300 ${!isPreviewMode ? 'hidden lg:flex' : 'flex'}`}>
          <ScrollArea className="h-full w-full">
            <div className="p-6 md:p-12 max-w-3xl mx-auto">
              {activeContent.trim() ? (
                <div 
                  className="prose prose-zinc dark:prose-invert max-w-none prose-headings:font-display prose-headings:font-bold prose-a:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-img:rounded-xl"
                  dangerouslySetInnerHTML={{ __html: cleanHtml }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground/40 font-medium italic mt-20">
                  Preview will appear here...
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
