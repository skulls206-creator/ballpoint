import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import {
  Save, Eye, EyeOff, Star, Archive, Trash2, RotateCcw,
  Bell, BellOff, Tag, X, Check, FileText,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { cn } from '../lib/utils';

// ─── Tag Input ──────────────────────────────────────────────────────────────
function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput('');
  };

  const removeTag = (tag: string) => onChange(tags.filter(t => t !== tag));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
          {tag}
          <button onClick={() => removeTag(tag)} className="hover:text-primary/60 transition-colors">
            <X size={9} />
          </button>
        </span>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
            if (e.key === 'Escape') { setEditing(false); setInput(''); }
            if (e.key === 'Backspace' && !input && tags.length) removeTag(tags[tags.length - 1]);
          }}
          onBlur={() => { if (input) addTag(input); setEditing(false); }}
          placeholder="tag name..."
          className="text-[10px] bg-transparent border-0 outline-none w-20 text-foreground placeholder:text-muted-foreground/40"
          autoFocus
        />
      ) : (
        <button onClick={() => setEditing(true)}
          className="flex items-center gap-0.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors px-1">
          <Tag size={9} /> <span>tag</span>
        </button>
      )}
    </div>
  );
}

// ─── Reminder Picker ─────────────────────────────────────────────────────────
function ReminderButton({ noteId, hasReminder, reminderTime, reminderStatus }: {
  noteId: string;
  hasReminder: boolean;
  reminderTime?: string;
  reminderStatus?: string;
}) {
  const setReminder     = useNotesStore(s => s.setReminder);
  const dismissReminder = useNotesStore(s => s.dismissReminder);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reminderTime) setValue(reminderTime.slice(0, 16));
  }, [reminderTime]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isFired = reminderStatus === 'fired';

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(p => !p)}
        title={hasReminder ? `Reminder: ${reminderTime ? format(new Date(reminderTime), 'MMM d, h:mm a') : ''}` : 'Set reminder'}
        className={cn(
          "h-6 px-2 rounded flex items-center gap-1 text-[11px] transition-colors border",
          hasReminder && !isFired
            ? "border-primary/40 bg-primary/10 text-primary"
            : isFired
            ? "border-orange-400/40 bg-orange-400/10 text-orange-400"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        {hasReminder ? <Bell size={10} /> : <BellOff size={10} />}
        {hasReminder && reminderTime && (
          <span>{format(new Date(reminderTime), 'MMM d')}</span>
        )}
        {isFired && <span className="text-orange-400">!</span>}
      </button>

      {open && (
        <div className="absolute top-8 right-0 z-50 bg-popover border border-popover-border rounded-lg shadow-lg p-3 w-56 space-y-2">
          <p className="text-[11px] font-medium text-foreground">Set reminder</p>
          <input
            type="datetime-local"
            value={value}
            min={new Date().toISOString().slice(0, 16)}
            onChange={e => setValue(e.target.value)}
            className="w-full text-[11px] bg-muted border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => { if (value) { setReminder(noteId, new Date(value).toISOString()); setOpen(false); } }}
              className="flex-1 h-6 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1"
            >
              <Check size={10} /> Save
            </button>
            {hasReminder && (
              <button
                onClick={() => { setReminder(noteId, null); setOpen(false); }}
                className="flex-1 h-6 rounded border border-destructive/40 text-destructive text-[11px] hover:bg-destructive/10 transition-colors flex items-center justify-center gap-1"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
          {isFired && (
            <button
              onClick={() => { dismissReminder(noteId); setOpen(false); }}
              className="w-full h-6 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Mark as done
            </button>
          )}
          <p className="text-[9px] text-muted-foreground/50 leading-relaxed">
            Reminders fire while the app is open. Keep this tab active for best reliability.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Editor ─────────────────────────────────────────────────────────────
export function Editor() {
  // Stable primitive selectors — each returns a primitive or stable reference
  const activeNoteId  = useNotesStore(s => s.activeNoteId);
  const notes         = useNotesStore(s => s.notes);
  const activeContent = useNotesStore(s => s.activeContent);
  const isDirty       = useNotesStore(s => s.isDirty);
  const activeSection = useNotesStore(s => s.activeSection);

  // Actions (stable Zustand references)
  const updateContent  = useNotesStore(s => s.updateContent);
  const saveActiveNote = useNotesStore(s => s.saveActiveNote);
  const renameNote     = useNotesStore(s => s.renameNote);
  const toggleFavorite = useNotesStore(s => s.toggleFavorite);
  const setNoteStatus  = useNotesStore(s => s.setNoteStatus);
  const setTags        = useNotesStore(s => s.setTags);
  const trashNote      = useNotesStore(s => s.trashNote);
  const restoreNote    = useNotesStore(s => s.restoreNote);

  const [showPreview, setShowPreview] = useState(false);
  const [titleValue, setTitleValue]   = useState('');
  const titleRef    = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Compute activeNote locally — notes is a stable ref until refreshNotes() replaces it
  const activeNote = useMemo(
    () => notes.find(n => n.id === activeNoteId) ?? null,
    [notes, activeNoteId]
  );

  const isTrash    = activeSection.type === 'trash';
  const isArchive  = activeSection.type === 'archive';
  const isReadOnly = isTrash;

  useEffect(() => {
    if (activeNote) setTitleValue(activeNote.title);
  }, [activeNoteId, activeNote?.title]);

  // Autosave 1.5s after last keystroke
  const handleContentChange = useCallback((content: string) => {
    updateContent(content);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveActiveNote(), 1500);
  }, [updateContent, saveActiveNote]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Ctrl+S manual save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveActiveNote(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveNote]);

  // Memoize the markdown render so it only re-runs when content changes
  const cleanHtml = useMemo(() => {
    if (!activeContent?.trim()) return '';
    const raw = marked(activeContent);
    return DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw));
  }, [activeContent]);

  if (!activeNoteId || !activeNote) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground/40">
        <FileText size={40} strokeWidth={1} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">No note selected</p>
        <p className="text-xs mt-1 opacity-70">Pick a note from the list or create a new one</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 border-b border-border bg-card/20 px-4 pt-3 pb-2 space-y-1.5">
        {/* Title row */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => toggleFavorite(activeNote.id)}
            className={cn("shrink-0 transition-colors", activeNote.isFavorite ? "text-primary" : "text-muted-foreground/25 hover:text-muted-foreground")}
            title={activeNote.isFavorite ? "Unfavorite" : "Favorite"}
          >
            <Star size={14} className={activeNote.isFavorite ? "fill-primary" : ""} />
          </button>

          <input
            ref={titleRef}
            type="text"
            value={titleValue}
            disabled={isReadOnly}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={() => {
              if (titleValue.trim() && titleValue !== activeNote.title) renameNote(activeNote.id, titleValue.trim());
            }}
            onKeyDown={e => { if (e.key === 'Enter') titleRef.current?.blur(); }}
            className="flex-1 bg-transparent border-0 outline-none text-base font-semibold text-foreground placeholder:text-muted-foreground/40 disabled:opacity-60 min-w-0"
            placeholder="Untitled"
          />

          <div className="flex items-center gap-1 shrink-0">
            {!isReadOnly && (
              <ReminderButton
                noteId={activeNote.id}
                hasReminder={activeNote.hasReminder}
                reminderTime={activeNote.reminderTime}
                reminderStatus={activeNote.reminderStatus}
              />
            )}

            {!isTrash && !isArchive && (
              <button onClick={() => setNoteStatus(activeNote.id, 'archived')} title="Archive"
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors border border-border">
                <Archive size={11} />
              </button>
            )}
            {isArchive && (
              <button onClick={() => restoreNote(activeNote.id)} title="Restore"
                className="h-6 px-2 rounded flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border">
                <RotateCcw size={10} /> Restore
              </button>
            )}
            {isTrash && (
              <button onClick={() => restoreNote(activeNote.id)} title="Restore from trash"
                className="h-6 px-2 rounded flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border">
                <RotateCcw size={10} /> Restore
              </button>
            )}

            {!isTrash && !isArchive && (
              <button onClick={() => trashNote(activeNote.id)} title="Move to trash"
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors border border-border">
                <Trash2 size={11} />
              </button>
            )}

            <button onClick={() => setShowPreview(p => !p)} title="Toggle preview"
              className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                showPreview ? "bg-muted text-foreground" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
              {showPreview ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>

            <button onClick={saveActiveNote} disabled={!isDirty || isReadOnly}
              title={isDirty ? "Save (Ctrl+S)" : "Saved"}
              className={cn("h-6 px-2 rounded flex items-center gap-1 text-[11px] border transition-all",
                isDirty
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border text-muted-foreground/30 cursor-default")}>
              <Save size={10} />
              {isDirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>

        {/* Tags + meta row */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {!isReadOnly ? (
              <TagInput
                tags={activeNote.tags}
                onChange={tags => setTags(activeNote.id, tags)}
              />
            ) : (
              <div className="flex flex-wrap gap-1">
                {activeNote.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/40 shrink-0">
            {format(new Date(activeNote.lastModified), 'MMM d, yyyy')}
          </span>
        </div>
      </header>

      {/* ── Reminder fired banner ── */}
      {activeNote.reminderStatus === 'fired' && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-400/10 border border-orange-400/20 text-[11px] text-orange-400 shrink-0">
          <Bell size={11} />
          <span>Reminder fired — {activeNote.reminderTime ? format(new Date(activeNote.reminderTime), 'MMM d, h:mm a') : ''}</span>
          <button
            onClick={() => useNotesStore.getState().dismissReminder(activeNote.id)}
            className="ml-auto hover:text-orange-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Editor / Preview ── */}
      <div className="flex-1 flex overflow-hidden">
        <div className={cn("flex-1 flex flex-col min-w-0", showPreview && "hidden lg:flex lg:w-1/2 lg:flex-none")}>
          <textarea
            value={activeContent}
            onChange={e => handleContentChange(e.target.value)}
            disabled={isReadOnly}
            placeholder={isReadOnly ? "(Note is in trash — restore to edit)" : "Start writing in Markdown..."}
            spellCheck={true}
            className="flex-1 w-full bg-transparent px-6 py-4 resize-none outline-none font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/30 disabled:opacity-50"
          />
        </div>

        {showPreview && (
          <div className="flex-1 border-l border-border bg-card/10 overflow-y-auto px-6 py-4">
            {activeContent.trim() ? (
              <div
                className="prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-a:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
                dangerouslySetInnerHTML={{ __html: cleanHtml }}
              />
            ) : (
              <p className="text-muted-foreground/30 italic text-sm">Preview will appear here...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
