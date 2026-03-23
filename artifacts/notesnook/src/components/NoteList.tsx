import { useState, useRef, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Star, MoreHorizontal, Trash2, Edit2, Archive, RotateCcw,
  Trash, FileText, Bell,
} from 'lucide-react';
import { useNotesStore, selectFilteredNotes } from '../lib/store';
import { cn } from '../lib/utils';

export function NoteList() {
  const activeNoteId  = useNotesStore(s => s.activeNoteId);
  const searchQuery   = useNotesStore(s => s.searchQuery);
  const activeSection = useNotesStore(s => s.activeSection);
  const notes         = useNotesStore(s => s.notes);

  // Actions (stable Zustand references)
  const selectNote           = useNotesStore(s => s.selectNote);
  const setSearchQuery       = useNotesStore(s => s.setSearchQuery);
  const trashNote            = useNotesStore(s => s.trashNote);
  const restoreNote          = useNotesStore(s => s.restoreNote);
  const permanentlyDeleteNote = useNotesStore(s => s.permanentlyDeleteNote);
  const toggleFavorite       = useNotesStore(s => s.toggleFavorite);
  const setNoteStatus        = useNotesStore(s => s.setNoteStatus);
  const renameNote           = useNotesStore(s => s.renameNote);

  // Derive filtered list locally — useMemo so it only recomputes when inputs change
  const filteredNotes = useMemo(
    () => selectFilteredNotes({ notes, activeSection, searchQuery } as any),
    [notes, activeSection, searchQuery]
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const inTrash   = activeSection.type === 'trash';
  const inArchive = activeSection.type === 'archive';

  const sectionTitle =
    activeSection.type === 'all'       ? 'Notes'
    : activeSection.type === 'favorites' ? 'Favorites'
    : activeSection.type === 'archive'   ? 'Archive'
    : activeSection.type === 'trash'     ? 'Trash'
    : `#${(activeSection as any).tag}`;

  return (
    <div className="w-[240px] shrink-0 flex flex-col h-full border-r border-border bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/60 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">{sectionTitle}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{filteredNotes.length}</span>
        </div>
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full h-6 pl-2 pr-6 text-[11px] bg-muted/60 border-0 rounded-md outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[10px]">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 px-4 text-center">
            <FileText size={28} className="mb-2 opacity-30" />
            <p className="text-[11px]">
              {searchQuery ? 'No matching notes' : inTrash ? 'Trash is empty' : inArchive ? 'No archived notes' : 'No notes yet'}
            </p>
          </div>
        ) : (
          filteredNotes.map(note => {
            const isActive   = activeNoteId === note.id;
            const isMenuOpen = menuId === note.id;
            const isRenaming = renamingId === note.id;

            return (
              <div
                key={note.id}
                onClick={() => { if (!inTrash && !isRenaming) selectNote(note.id); }}
                className={cn(
                  "group relative px-3 py-2 transition-colors border-b border-border/30",
                  isActive
                    ? "bg-accent/60 border-l-2 border-l-primary"
                    : !inTrash ? "hover:bg-muted/50 cursor-pointer" : ""
                )}
              >
                {/* Title row */}
                <div className="flex items-center gap-1 min-w-0">
                  {note.isFavorite && <Star size={10} className="text-primary shrink-0 fill-primary" />}
                  {note.hasReminder && note.reminderStatus === 'fired' && (
                    <Bell size={10} className="text-orange-400 shrink-0" />
                  )}
                  {isRenaming ? (
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { renameNote(note.id, renameValue); setRenamingId(null); }
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => { renameNote(note.id, renameValue); setRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-[12px] font-medium bg-transparent border-b border-primary outline-none"
                    />
                  ) : (
                    <span className={cn("flex-1 text-[12px] font-medium truncate", isActive ? "text-foreground" : "text-foreground/80")}>
                      {note.title}
                    </span>
                  )}

                  {/* Context menu trigger */}
                  <div className="relative">
                    <button
                      onClick={e => { e.stopPropagation(); setMenuId(isMenuOpen ? null : note.id); }}
                      className={cn(
                        "p-0.5 rounded transition-opacity text-muted-foreground hover:text-foreground",
                        isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <MoreHorizontal size={12} />
                    </button>

                    {isMenuOpen && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-5 z-50 w-36 bg-popover border border-popover-border rounded-lg shadow-lg py-0.5 text-[11px]"
                        onClick={e => e.stopPropagation()}
                      >
                        {!inTrash && !inArchive && (
                          <>
                            <button onClick={() => { toggleFavorite(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors">
                              <Star size={11} className={note.isFavorite ? "fill-primary text-primary" : ""} />
                              {note.isFavorite ? 'Unfavorite' : 'Favorite'}
                            </button>
                            <button onClick={() => { setRenamingId(note.id); setRenameValue(note.title); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors">
                              <Edit2 size={11} /> Rename
                            </button>
                            <button onClick={() => { setNoteStatus(note.id, 'archived'); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors">
                              <Archive size={11} /> Archive
                            </button>
                            <div className="my-0.5 border-t border-border" />
                            <button onClick={() => { trashNote(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors">
                              <Trash2 size={11} /> Move to Trash
                            </button>
                          </>
                        )}
                        {inArchive && (
                          <>
                            <button onClick={() => { restoreNote(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors">
                              <RotateCcw size={11} /> Restore
                            </button>
                            <button onClick={() => { trashNote(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors">
                              <Trash2 size={11} /> Move to Trash
                            </button>
                          </>
                        )}
                        {inTrash && (
                          <>
                            <button onClick={() => { restoreNote(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors">
                              <RotateCcw size={11} /> Restore
                            </button>
                            <button onClick={() => { permanentlyDeleteNote(note.id); setMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors">
                              <Trash size={11} /> Delete Forever
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {note.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[9px] px-1 py-px rounded bg-primary/10 text-primary/80 font-medium">
                        {tag}
                      </span>
                    ))}
                    {note.tags.length > 3 && (
                      <span className="text-[9px] text-muted-foreground">+{note.tags.length - 3}</span>
                    )}
                  </div>
                )}

                {/* Date */}
                <div className={cn("text-[10px] mt-0.5", isActive ? "text-muted-foreground/70" : "text-muted-foreground/50")}>
                  {formatDistanceToNow(new Date(note.lastModified), { addSuffix: true })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Trash: empty all button */}
      {inTrash && filteredNotes.length > 0 && (
        <div className="px-3 py-2 border-t border-border shrink-0">
          <button
            onClick={() => {
              if (confirm('Permanently delete all trashed notes? This cannot be undone.')) {
                filteredNotes.forEach(n => permanentlyDeleteNote(n.id));
              }
            }}
            className="w-full text-[11px] text-destructive/70 hover:text-destructive transition-colors py-1"
          >
            Empty Trash ({filteredNotes.length})
          </button>
        </div>
      )}
    </div>
  );
}
