import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Star, Trash2, Edit2, Archive, RotateCcw,
  Trash, FileText, Bell, Copy, ExternalLink, Menu,
  Cloud, CloudOff, UploadCloud,
} from 'lucide-react';
import { useNotesStore, selectFilteredNotes, isTaskSection } from '../lib/store';
import { TaskList } from './TaskList';
import { cn } from '../lib/utils';

// ─── Context Menu ─────────────────────────────────────────────────────────────
interface ContextMenuState { noteId: string; x: number; y: number }

function ContextMenu({
  state,
  onClose,
  inTrash,
  inArchive,
  isFavorite,
  onSelect,
  onRename,
  onFavorite,
  onArchive,
  onTrash,
  onRestore,
  onDeleteForever,
  onDuplicate,
  onOpenSideBySide,
}: {
  state: ContextMenuState;
  onClose: () => void;
  inTrash: boolean;
  inArchive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onRename: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onDuplicate: () => void;
  onOpenSideBySide: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Position so menu stays inside viewport
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth: W, innerHeight: H } = window;
    const rect = el.getBoundingClientRect();
    setPos({
      x: state.x + rect.width  > W ? state.x - rect.width  : state.x,
      y: state.y + rect.height > H ? state.y - rect.height : state.y,
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const hide = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', hide);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', hide);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  type MenuItem =
    | { kind: 'action'; icon: React.ReactNode; label: string; danger?: boolean; action: () => void }
    | { kind: 'divider' };

  const items: MenuItem[] = [];

  if (!inTrash) {
    items.push({ kind: 'action', icon: <ExternalLink size={12} />, label: 'Open note', action: onSelect });
    items.push({ kind: 'divider' });
    items.push({ kind: 'action', icon: <Star size={12} className={isFavorite ? 'fill-primary text-primary' : ''} />, label: isFavorite ? 'Unpin from Favorites' : 'Pin to Favorites', action: onFavorite });
    items.push({ kind: 'action', icon: <Edit2 size={12} />, label: 'Rename', action: onRename });
    items.push({ kind: 'action', icon: <Copy size={12} />, label: 'Duplicate', action: onDuplicate });
    if (!inArchive) {
      items.push({ kind: 'divider' });
      items.push({ kind: 'action', icon: <Archive size={12} />, label: 'Move to Archive', action: onArchive });
      items.push({ kind: 'action', icon: <Trash2 size={12} />, label: 'Move to Trash', danger: true, action: onTrash });
    } else {
      items.push({ kind: 'divider' });
      items.push({ kind: 'action', icon: <RotateCcw size={12} />, label: 'Restore note', action: onRestore });
      items.push({ kind: 'action', icon: <Trash2 size={12} />, label: 'Move to Trash', danger: true, action: onTrash });
    }
  } else {
    items.push({ kind: 'action', icon: <RotateCcw size={12} />, label: 'Restore note', action: onRestore });
    items.push({ kind: 'divider' });
    items.push({ kind: 'action', icon: <Trash size={12} />, label: 'Delete forever', danger: true, action: onDeleteForever });
  }

  return (
    <div
      ref={ref}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-[200] w-52 bg-popover border border-popover-border rounded-xl shadow-xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, i) =>
        item.kind === 'divider' ? (
          <div key={i} className="my-0.5 mx-2 border-t border-border/60" />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors text-left",
              item.danger
                ? "text-destructive hover:bg-destructive/10"
                : "text-foreground/80 hover:bg-accent hover:text-foreground"
            )}
          >
            <span className={item.danger ? "text-destructive" : "text-muted-foreground"}>
              {item.icon}
            </span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Note List ────────────────────────────────────────────────────────────────
export function NoteList({ onOpenSidebar, onNoteOpen }: { onOpenSidebar?: () => void; onNoteOpen?: () => void }) {
  // All hooks must be called unconditionally (React rules)
  const activeSection = useNotesStore(s => s.activeSection);
  const activeNoteId  = useNotesStore(s => s.activeNoteId);
  const searchQuery   = useNotesStore(s => s.searchQuery);
  const notes         = useNotesStore(s => s.notes);
  const metadata      = useNotesStore(s => s.metadata);

  const selectNote            = useNotesStore(s => s.selectNote);
  const setSearchQuery        = useNotesStore(s => s.setSearchQuery);
  const trashNote             = useNotesStore(s => s.trashNote);
  const restoreNote           = useNotesStore(s => s.restoreNote);
  const permanentlyDeleteNote = useNotesStore(s => s.permanentlyDeleteNote);
  const toggleFavorite        = useNotesStore(s => s.toggleFavorite);
  const setNoteStatus         = useNotesStore(s => s.setNoteStatus);
  const renameNote            = useNotesStore(s => s.renameNote);
  const createNewNote         = useNotesStore(s => s.createNewNote);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTarget = useRef<string | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent, noteId: string) => {
    longPressTarget.current = noteId;
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setCtxMenu({ noteId, x: touch.clientX, y: touch.clientY });
      longPressTarget.current = null;
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const filteredNotes = useMemo(
    () => isTaskSection(activeSection)
      ? []
      : selectFilteredNotes({ notes, activeSection, searchQuery } as any),
    [notes, activeSection, searchQuery]
  );

  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ noteId, x: e.clientX, y: e.clientY });
  }, []);

  const closeCtx = useCallback(() => setCtxMenu(null), []);

  // All hooks declared — now safe to branch
  if (isTaskSection(activeSection)) return <TaskList onOpenSidebar={onOpenSidebar} />;

  const inTrash   = activeSection.type === 'trash';
  const inArchive = activeSection.type === 'archive';

  const sectionTitle =
    activeSection.type === 'all'         ? 'Notes'
    : activeSection.type === 'favorites' ? 'Favorites'
    : activeSection.type === 'archive'   ? 'Archive'
    : activeSection.type === 'trash'     ? 'Trash'
    : `#${(activeSection as any).tag}`;

  const ctxNote = ctxMenu ? notes.find(n => n.id === ctxMenu.noteId) : null;

  return (
    <div className="w-full md:w-[240px] shrink-0 flex flex-col h-full border-r border-border bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 md:py-2 border-b border-border/60 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Hamburger — mobile only */}
            <button
              onClick={onOpenSidebar}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-foreground/50 hover:text-foreground hover:bg-muted transition-colors -ml-1"
              title="Menu"
            >
              <Menu size={18} />
            </button>
            <span className="text-[12px] md:text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">{sectionTitle}</span>
          </div>
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
            {!searchQuery && !inTrash && !inArchive && (
              <p className="text-[10px] mt-1 opacity-60">Tap to open · Hold for options</p>
            )}
          </div>
        ) : (
          filteredNotes.map(note => {
            const isActive   = activeNoteId === note.id;
            const isRenaming = renamingId === note.id;

            return (
              <div
                key={note.id}
                onClick={() => {
                  if (isRenaming) return;
                  if (!inTrash) {
                    selectNote(note.id);
                    onNoteOpen?.();
                  }
                }}
                onContextMenu={e => handleContextMenu(e, note.id)}
                onTouchStart={e => handleTouchStart(e, note.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                className={cn(
                  "group relative px-3 py-4 md:py-2.5 transition-colors border-b border-border/30 select-none active:bg-accent/80",
                  isActive
                    ? "bg-accent/60 border-l-2 border-l-primary"
                    : "hover:bg-muted/50 cursor-pointer"
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
                  {/* Cloud sync badge */}
                  {(() => {
                    const rs = metadata[note.id]?.remoteStatus;
                    if (rs === 'synced') return <Cloud size={9} className="shrink-0 text-green-500/70" aria-label="Backed up to cloud" />;
                    if (rs === 'pendingUpload') return <UploadCloud size={9} className="shrink-0 text-amber-500/70" aria-label="Pending cloud backup" />;
                    return <CloudOff size={9} className="shrink-0 text-muted-foreground/25" aria-label="Not yet backed up" />;
                  })()}
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

      {/* Right-click context menu */}
      {ctxMenu && ctxNote && (
        <ContextMenu
          state={ctxMenu}
          onClose={closeCtx}
          inTrash={inTrash}
          inArchive={inArchive}
          isFavorite={ctxNote.isFavorite}
          onSelect={() => selectNote(ctxNote.id)}
          onRename={() => { setRenamingId(ctxNote.id); setRenameValue(ctxNote.title); }}
          onFavorite={() => toggleFavorite(ctxNote.id)}
          onArchive={() => setNoteStatus(ctxNote.id, 'archived')}
          onTrash={() => trashNote(ctxNote.id)}
          onRestore={() => restoreNote(ctxNote.id)}
          onDeleteForever={() => {
            if (confirm(`Permanently delete "${ctxNote.title}"? This cannot be undone.`)) {
              permanentlyDeleteNote(ctxNote.id);
            }
          }}
          onDuplicate={() => createNewNote(`${ctxNote.title} (copy)`)}
          onOpenSideBySide={() => selectNote(ctxNote.id)}
        />
      )}
    </div>
  );
}
