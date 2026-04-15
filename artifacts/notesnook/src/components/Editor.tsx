import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Save, Eye, EyeOff, Star, Archive, Trash2, RotateCcw,
  Bell, BellOff, Tag, X, Check, FileText,
  Bold, Italic, Strikethrough, Code, Code2, Link2,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, Minus,
  Image, History, Clock, ChevronRight, ChevronLeft,
  Paperclip, Download, FileText as FileIcon, Loader2,
  Copy, Scissors, Clipboard, AlignLeft,
  Pin, PinOff, Lock, LockOpen, BookOpen, FileDown, Keyboard,
  Search, ArrowUp, ArrowDown, Replace, MoreHorizontal,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { cn } from '../lib/utils';
import { loadVersions, NoteVersion } from '../lib/versions';
import {
  writeAttachment, readAttachment, listAttachments, deleteAttachment,
  AttachmentInfo, isImageMime, formatBytes,
} from '../lib/attachments';

// ─── Shared helpers ───────────────────────────────────────────────────────────
/** Convert a UTC ISO string → local "YYYY-MM-DDTHH:mm" for datetime-local inputs */
function toLocalInputVal(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// ─── Markdown Toolbar ─────────────────────────────────────────────────────────
type WrapStyle = { prefix: string; suffix?: string; block?: boolean; line?: boolean; placeholder?: string };

function insertMarkdown(
  textarea: HTMLTextAreaElement,
  style: WrapStyle,
  onChange: (val: string) => void
) {
  const { selectionStart: ss, selectionEnd: se, value } = textarea;
  const sel = value.slice(ss, se);
  const { prefix, suffix = prefix, block = false, line = false, placeholder = 'text' } = style;

  let newText: string;
  let cursorStart: number;
  let cursorEnd: number;

  if (line) {
    // Prepend prefix to each selected line (or current line)
    const lineStart = value.lastIndexOf('\n', ss - 1) + 1;
    const lineEnd   = value.indexOf('\n', se);
    const end       = lineEnd === -1 ? value.length : lineEnd;
    const lines     = value.slice(lineStart, end).split('\n');
    const newLines  = lines.map(l => prefix + l);
    newText = value.slice(0, lineStart) + newLines.join('\n') + value.slice(end);
    cursorStart = lineStart;
    cursorEnd   = lineStart + newLines.join('\n').length;
  } else if (block) {
    // Code block
    const insert = `${prefix}\n${sel || placeholder}\n${suffix}`;
    newText = value.slice(0, ss) + insert + value.slice(se);
    cursorStart = ss + prefix.length + 1;
    cursorEnd   = cursorStart + (sel || placeholder).length;
  } else {
    // Inline wrap — toggle off if already wrapped
    const alreadyWrapped = value.slice(ss - prefix.length, ss) === prefix &&
                           value.slice(se, se + suffix.length) === suffix;
    if (alreadyWrapped) {
      newText = value.slice(0, ss - prefix.length) + sel + value.slice(se + suffix.length);
      cursorStart = ss - prefix.length;
      cursorEnd   = cursorStart + sel.length;
    } else {
      const inner = sel || placeholder;
      newText = value.slice(0, ss) + prefix + inner + suffix + value.slice(se);
      cursorStart = ss + prefix.length;
      cursorEnd   = cursorStart + inner.length;
    }
  }

  onChange(newText);
  // Restore selection after React re-render
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorStart, cursorEnd);
  });
}

function insertLink(
  textarea: HTMLTextAreaElement,
  onChange: (val: string) => void
) {
  const { selectionStart: ss, selectionEnd: se, value } = textarea;
  const sel = value.slice(ss, se) || 'link text';
  const url = prompt('URL:', 'https://');
  if (!url) return;
  const insert = `[${sel}](${url})`;
  const newText = value.slice(0, ss) + insert + value.slice(se);
  onChange(newText);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(ss, ss + insert.length);
  });
}

/**
 * Handle Enter key inside the textarea to continue list/task prefixes.
 * - `- `, `- [ ] `, `- [x] `, `> `, `1. ` all continue on the next line.
 * - Pressing Enter on an empty list item (just the prefix) exits list mode.
 */
function handleListContinuation(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange: (val: string) => void,
) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

  const ta = e.currentTarget;
  const { selectionStart: pos, selectionEnd: end, value } = ta;
  if (pos !== end) return; // don't intercept when text is selected

  // Find start of the current line
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  const currentLine = value.slice(lineStart, pos);

  // Ordered: task-done before task-open before bullet so regex doesn't mis-match
  const patterns: [RegExp, string | null][] = [
    [/^(\s*- \[)[xX](\] )/, '$1 $2'],   // - [x] → - [ ]
    [/^(\s*- \[ \] )/, null],             // - [ ]
    [/^(\s*- )/, null],                   // -
    [/^(\s*> )/, null],                   // >
    [/^(\s*\d+\. )/, null],               // 1.
  ];

  let prefix: string | null = null;
  for (const [re, replacement] of patterns) {
    const m = currentLine.match(re);
    if (m) {
      // For task-done: transform [x] → [ ] for the new line
      prefix = replacement
        ? currentLine.slice(0, m[0].length).replace(re, replacement)
        : m[1] ?? m[0];
      break;
    }
  }

  if (prefix === null) return; // not a list line — let browser handle Enter

  e.preventDefault();

  const itemContent = currentLine.slice(prefix.length).trim();

  if (itemContent === '') {
    // Empty item → exit list mode: strip the prefix from the current line
    const newValue = value.slice(0, lineStart) + value.slice(lineStart + prefix.length);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(lineStart, lineStart);
    });
    return;
  }

  // Insert newline + prefix after cursor
  const insert = '\n' + prefix;
  const newValue = value.slice(0, pos) + insert + value.slice(pos);
  const newPos = pos + insert.length;
  onChange(newValue);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(newPos, newPos);
  });
}

function insertImage(
  textarea: HTMLTextAreaElement,
  onChange: (val: string) => void
) {
  const { selectionStart: ss, selectionEnd: se, value } = textarea;
  const url = prompt('Image URL:', 'https://');
  if (!url) return;
  const alt = value.slice(ss, se) || 'image';
  const insert = `![${alt}](${url})`;
  const newText = value.slice(0, ss) + insert + value.slice(se);
  onChange(newText);
  requestAnimationFrame(() => { textarea.focus(); });
}

type ToolbarButton =
  | { kind: 'btn'; icon: React.ReactNode; title: string; style: WrapStyle; shortcut?: string }
  | { kind: 'link' }
  | { kind: 'image' }
  | { kind: 'sep' };

function MarkdownToolbar({
  textareaRef,
  onChange,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (val: string) => void;
}) {
  const tools: ToolbarButton[] = [
    { kind: 'btn', icon: <Bold size={12} />,          title: 'Bold (Ctrl+B)',        style: { prefix: '**' },                           shortcut: 'b' },
    { kind: 'btn', icon: <Italic size={12} />,        title: 'Italic (Ctrl+I)',      style: { prefix: '_' },                             shortcut: 'i' },
    { kind: 'btn', icon: <Strikethrough size={12} />, title: 'Strikethrough',        style: { prefix: '~~' } },
    { kind: 'btn', icon: <Code size={12} />,          title: 'Inline code',          style: { prefix: '`', suffix: '`', placeholder: 'code' } },
    { kind: 'sep' },
    { kind: 'btn', icon: <Heading1 size={12} />,      title: 'Heading 1',            style: { prefix: '# ', line: true } },
    { kind: 'btn', icon: <Heading2 size={12} />,      title: 'Heading 2',            style: { prefix: '## ', line: true } },
    { kind: 'btn', icon: <Heading3 size={12} />,      title: 'Heading 3',            style: { prefix: '### ', line: true } },
    { kind: 'sep' },
    { kind: 'btn', icon: <List size={12} />,          title: 'Bullet list',          style: { prefix: '- ', line: true } },
    { kind: 'btn', icon: <ListOrdered size={12} />,   title: 'Numbered list',        style: { prefix: '1. ', line: true } },
    { kind: 'btn', icon: <ListChecks size={12} />,    title: 'Task list',            style: { prefix: '- [ ] ', line: true } },
    { kind: 'sep' },
    { kind: 'btn', icon: <Quote size={12} />,         title: 'Blockquote',           style: { prefix: '> ', line: true } },
    { kind: 'btn', icon: <Code2 size={12} />,         title: 'Code block',           style: { prefix: '```', suffix: '```', block: true, placeholder: 'code' } },
    { kind: 'btn', icon: <Minus size={12} />,         title: 'Horizontal rule',      style: { prefix: '\n---\n', suffix: '', placeholder: '' } },
    { kind: 'sep' },
    { kind: 'link' },
    { kind: 'image' },
  ];

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const ta = textareaRef.current;
    if (!ta || document.activeElement !== ta) return;
    if (e.key === 'b') { e.preventDefault(); insertMarkdown(ta, { prefix: '**' }, onChange); }
    if (e.key === 'i') { e.preventDefault(); insertMarkdown(ta, { prefix: '_' }, onChange); }
    if (e.key === 'k') { e.preventDefault(); insertLink(ta, onChange); }
  }, [textareaRef, onChange]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const run = (tool: ToolbarButton) => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (tool.kind === 'btn') insertMarkdown(ta, tool.style, onChange);
    if (tool.kind === 'link') insertLink(ta, onChange);
    if (tool.kind === 'image') insertImage(ta, onChange);
  };

  return (
    <div className="shrink-0 flex items-center gap-0.5 px-3 py-1 border-b border-border bg-card/30 overflow-x-auto scrollbar-none">
      {tools.map((tool, i) => {
        if (tool.kind === 'sep') {
          return <div key={i} className="w-px h-4 bg-border mx-1 shrink-0" />;
        }
        return (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); run(tool); }}
            title={tool.kind === 'link' ? 'Insert link (Ctrl+K)' : tool.kind === 'image' ? 'Insert image' : tool.title}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            {tool.kind === 'link'  ? <Link2 size={12} />  :
             tool.kind === 'image' ? <Image size={12} />   :
             tool.icon}
          </button>
        );
      })}
    </div>
  );
}

// ─── Version History Panel ───────────────────────────────────────────────────
function VersionHistory({
  noteId,
  userId,
  encryptionKey,
  onRestore,
  onClose,
}: {
  noteId: string;
  userId: number;
  encryptionKey: CryptoKey | null;
  onRestore: (content: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions]     = useState<NoteVersion[]>([]);
  const [preview,  setPreview]      = useState<NoteVersion | null>(null);
  const [loading,  setLoading]      = useState(true);

  useEffect(() => {
    setLoading(true);
    loadVersions(userId, noteId, encryptionKey)
      .then(v => { setVersions([...v].reverse()); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId, noteId, encryptionKey]);

  const previewHtml = useMemo(() => {
    if (!preview) return '';
    const raw = marked(preview.content);
    return DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw));
  }, [preview]);

  return (
    <div className="w-64 shrink-0 flex flex-col border-l border-border bg-card/20 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <History size={12} className="text-primary" /> Version History
        </div>
        <button onClick={onClose} className="text-muted-foreground/50 hover:text-foreground transition-colors">
          <X size={12} />
        </button>
      </div>

      {preview ? (
        /* Preview pane */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0 bg-primary/5">
            <Clock size={10} className="text-primary shrink-0" />
            <span className="text-[10px] text-muted-foreground flex-1 truncate">
              {format(new Date(preview.timestamp), 'MMM d, yyyy · h:mm a')}
            </span>
            <button
              onClick={() => { onRestore(preview.content); onClose(); }}
              className="shrink-0 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
            >
              Restore
            </button>
            <button onClick={() => setPreview(null)} className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors ml-0.5">
              <X size={10} />
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-3 prose dark:prose-invert prose-xs max-w-none text-[11px] prose-headings:text-[13px] prose-p:my-1 prose-headings:my-1"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      ) : (
        /* Version list */
        <div className="flex-1 overflow-y-auto py-1">
          {loading && (
            <p className="text-[11px] text-muted-foreground/40 text-center py-6">Loading…</p>
          )}
          {!loading && versions.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
              <Clock size={24} className="text-muted-foreground/20" strokeWidth={1.5} />
              <p className="text-[11px] text-muted-foreground/50">No versions yet — versions are saved automatically each time you save the note.</p>
            </div>
          )}
          {versions.map((v, i) => (
            <button
              key={v.timestamp}
              onClick={() => setPreview(v)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left group"
            >
              <Clock size={10} className="text-muted-foreground/30 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground truncate">
                  {i === 0 ? 'Latest save' : formatDistanceToNow(new Date(v.timestamp), { addSuffix: true })}
                </p>
                <p className="text-[10px] text-muted-foreground/50 truncate">
                  {format(new Date(v.timestamp), 'MMM d · h:mm a')}
                </p>
              </div>
              <ChevronRight size={10} className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Textarea Right-click Context Menu ───────────────────────────────────────
type CtxPos = { x: number; y: number };

function TextareaContextMenu({
  pos,
  onClose,
  textareaRef,
  onChange,
}: {
  pos: CtxPos;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (val: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust so menu never goes off-screen
  const [adjusted, setAdjusted] = useState(pos);
  useEffect(() => {
    if (!ref.current) return;
    const { innerWidth: W, innerHeight: H } = window;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setAdjusted({
      x: Math.min(pos.x, W - w - 8),
      y: Math.min(pos.y, H - h - 8),
    });
  }, [pos]);

  const groups: { label?: string; items: { icon: React.ReactNode; label: string; action: () => void }[] }[] = [
    {
      label: 'Clipboard',
      items: [
        {
          icon: <Copy size={11} />, label: 'Copy',
          action: () => {
            const ta = textareaRef.current; if (!ta) return;
            const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
            if (sel) navigator.clipboard.writeText(sel).catch(() => {});
          },
        },
        {
          icon: <Scissors size={11} />, label: 'Cut',
          action: () => {
            const ta = textareaRef.current; if (!ta) return;
            const { selectionStart: ss, selectionEnd: se, value } = ta;
            const sel = value.slice(ss, se); if (!sel) return;
            navigator.clipboard.writeText(sel).catch(() => {});
            const next = value.slice(0, ss) + value.slice(se);
            onChange(next);
            requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ss, ss); });
          },
        },
        {
          icon: <Clipboard size={11} />, label: 'Paste',
          action: async () => {
            const ta = textareaRef.current; if (!ta) return;
            try {
              const text = await navigator.clipboard.readText();
              const { selectionStart: ss, selectionEnd: se, value } = ta;
              const next = value.slice(0, ss) + text + value.slice(se);
              onChange(next);
              requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ss + text.length, ss + text.length); });
            } catch { /* clipboard permission denied */ }
          },
        },
        {
          icon: <AlignLeft size={11} />, label: 'Select All',
          action: () => {
            const ta = textareaRef.current; if (!ta) return;
            ta.focus(); ta.select();
          },
        },
      ],
    },
    {
      items: [
        { icon: <Bold size={11} />,          label: 'Bold',           action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '**' }, onChange); } },
        { icon: <Italic size={11} />,        label: 'Italic',         action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '_' }, onChange); } },
        { icon: <Strikethrough size={11} />, label: 'Strikethrough',  action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '~~' }, onChange); } },
        { icon: <Code size={11} />,          label: 'Inline code',    action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '`', suffix: '`', placeholder: 'code' }, onChange); } },
      ],
    },
    {
      label: 'Headings',
      items: [
        { icon: <Heading1 size={11} />, label: 'Heading 1', action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '# ', line: true }, onChange); } },
        { icon: <Heading2 size={11} />, label: 'Heading 2', action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '## ', line: true }, onChange); } },
        { icon: <Heading3 size={11} />, label: 'Heading 3', action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '### ', line: true }, onChange); } },
      ],
    },
    {
      label: 'Lists',
      items: [
        { icon: <List size={11} />,        label: 'Bullet list',   action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '- ', line: true }, onChange); } },
        { icon: <ListOrdered size={11} />, label: 'Numbered list', action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '1. ', line: true }, onChange); } },
        { icon: <ListChecks size={11} />,  label: 'Task list',     action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '- [ ] ', line: true }, onChange); } },
      ],
    },
    {
      label: 'Insert',
      items: [
        { icon: <Quote size={11} />,  label: 'Blockquote',     action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '> ', line: true }, onChange); } },
        { icon: <Code2 size={11} />,  label: 'Code block',     action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '```', suffix: '```', block: true, placeholder: 'code' }, onChange); } },
        { icon: <Link2 size={11} />,  label: 'Insert link',    action: () => { const ta = textareaRef.current; if (ta) insertLink(ta, onChange); } },
        { icon: <Minus size={11} />,  label: 'Horizontal rule', action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '\n---\n', suffix: '', placeholder: '' }, onChange); } },
      ],
    },
  ];

  const run = (action: () => void) => { onClose(); action(); };

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: adjusted.y, left: adjusted.x, zIndex: 9999 }}
      className="min-w-[180px] bg-popover border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 border-t border-border" />}
          {group.label && (
            <p className="px-3 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">
              {group.label}
            </p>
          )}
          {group.items.map((item, ii) => (
            <button
              key={ii}
              onMouseDown={e => { e.preventDefault(); run(item.action); }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left"
            >
              <span className="text-muted-foreground/60">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Selection Floating Toolbar ──────────────────────────────────────────────
function SelectionFloatingToolbar({
  textareaRef,
  onChange,
  anchorPos,
  onDismiss,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (val: string) => void;
  anchorPos: { x: number; y: number };
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Clamp to viewport after mount
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: anchorPos.y - 46,
    left: anchorPos.x,
    transform: 'translateX(-50%)',
    zIndex: 9999,
  });

  useEffect(() => {
    if (!ref.current) return;
    const { innerWidth: W } = window;
    const { offsetWidth: w } = ref.current;
    const clampedLeft = Math.max(w / 2 + 8, Math.min(anchorPos.x, W - w / 2 - 8));
    const clampedTop  = Math.max(8, anchorPos.y - 46);
    setStyle({ position: 'fixed', top: clampedTop, left: clampedLeft, transform: 'translateX(-50%)', zIndex: 9999 });
  }, [anchorPos]);

  const actions = [
    {
      icon: <Bold size={12} />, title: 'Bold (Ctrl+B)',
      action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '**' }, onChange); },
    },
    {
      icon: <Italic size={12} />, title: 'Italic (Ctrl+I)',
      action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '_' }, onChange); },
    },
    {
      icon: <Strikethrough size={12} />, title: 'Strikethrough',
      action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '~~' }, onChange); },
    },
    {
      icon: <Code size={12} />, title: 'Inline code',
      action: () => { const ta = textareaRef.current; if (ta) insertMarkdown(ta, { prefix: '`', suffix: '`', placeholder: 'code' }, onChange); },
    },
    { kind: 'sep' as const },
    {
      icon: <Link2 size={12} />, title: 'Insert link (Ctrl+K)',
      action: () => { const ta = textareaRef.current; if (ta) insertLink(ta, onChange); },
    },
    { kind: 'sep' as const },
    {
      icon: <Copy size={12} />, title: 'Copy selection',
      action: () => {
        const ta = textareaRef.current; if (!ta) return;
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        if (sel) { navigator.clipboard.writeText(sel).catch(() => {}); onDismiss(); }
      },
    },
  ];

  return createPortal(
    <div ref={ref} style={style}
      className="flex items-center gap-px px-1 py-1 rounded-lg bg-popover border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-100"
    >
      {actions.map((a, i) => {
        if ('kind' in a && a.kind === 'sep') {
          return <div key={i} className="w-px h-4 bg-border mx-0.5 shrink-0" />;
        }
        return (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); a.action(); }}
            title={'title' in a ? a.title : ''}
            className="w-7 h-7 flex items-center justify-center rounded text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {'icon' in a ? a.icon : null}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

// ─── Insert at cursor (for image embed) ──────────────────────────────────────
function insertAtCursor(
  textarea: HTMLTextAreaElement,
  text: string,
  onChange: (val: string) => void
) {
  const { selectionStart: ss, selectionEnd: se, value } = textarea;
  const newVal = value.slice(0, ss) + text + value.slice(se);
  onChange(newVal);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(ss + text.length, ss + text.length);
  });
}

// ─── Attachment Strip ─────────────────────────────────────────────────────────
function AttachmentStrip({
  noteId,
  vault,
  encryptionKey,
  textareaRef,
  onContentChange,
}: {
  noteId: string;
  vault: FileSystemDirectoryHandle;
  encryptionKey: CryptoKey | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onContentChange: (val: string) => void;
}) {
  const [attachments,  setAttachments]  = useState<AttachmentInfo[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [downloading,  setDownloading]  = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    listAttachments(vault, noteId).then(setAttachments).catch(() => {});
  }, [vault, noteId]);

  useEffect(() => { reload(); }, [reload]);

  const processFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      if (isImg) {
        // Embed image inline as base64 — encrypted as part of the note content
        const reader = new FileReader();
        await new Promise<void>(resolve => {
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const md = `\n![${file.name}](${dataUrl})\n`;
            if (textareaRef.current) insertAtCursor(textareaRef.current, md, onContentChange);
            resolve();
          };
          reader.readAsDataURL(file);
        });
      } else {
        // Store non-image files in vault — encrypted if key present
        const data = new Uint8Array(await file.arrayBuffer());
        await writeAttachment(vault, noteId, file.name, data, encryptionKey);
      }
    }
    setUploading(false);
    reload();
  }, [vault, noteId, encryptionKey, textareaRef, onContentChange, reload]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    processFiles(files);
  };

  const handleDownload = async (info: AttachmentInfo) => {
    setDownloading(info.name);
    try {
      const data = await readAttachment(vault, noteId, info.name, encryptionKey);
      const blob = new Blob([data], { type: info.mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = info.name; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (info: AttachmentInfo) => {
    if (!confirm(`Delete attachment "${info.name}"?`)) return;
    await deleteAttachment(vault, noteId, info.name);
    reload();
  };

  const hasAttachments = attachments.length > 0;

  if (!hasAttachments && !uploading) {
    return (
      <div className="shrink-0 flex items-center px-3 py-1 border-b border-border bg-card/20">
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleInputChange} />
        <button
          onMouseDown={e => { e.preventDefault(); fileInputRef.current?.click(); }}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <Paperclip size={11} /> Attach file
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border bg-card/20 px-3 py-1.5 space-y-1">
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleInputChange} />

      {/* File chips */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {attachments.map(info => (
          <div key={info.name}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted border border-border text-[11px] text-foreground group max-w-[220px]"
          >
            <FileIcon size={10} className="text-muted-foreground/50 shrink-0" />
            <span className="truncate flex-1 min-w-0" title={info.name}>{info.name}</span>
            <span className="text-[10px] text-muted-foreground/40 shrink-0">{formatBytes(info.size)}</span>
            {info.encrypted && (
              <span title="Encrypted on disk" className="text-[9px] text-green-500 shrink-0">🔒</span>
            )}
            <button
              onClick={() => handleDownload(info)}
              disabled={downloading === info.name}
              title="Download"
              className="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0 disabled:opacity-50"
            >
              {downloading === info.name ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            </button>
            <button
              onClick={() => handleDelete(info)}
              title="Delete"
              className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {/* Uploading indicator */}
        {uploading && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted border border-border text-[11px] text-muted-foreground/60">
            <Loader2 size={10} className="animate-spin" /> Uploading…
          </div>
        )}

        {/* Add more button */}
        <button
          onMouseDown={e => { e.preventDefault(); fileInputRef.current?.click(); }}
          title="Attach another file"
          className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground/40 hover:text-muted-foreground hover:border-muted-foreground/40 transition-colors"
        >
          <Paperclip size={10} /> Attach
        </button>
      </div>
    </div>
  );
}

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
  const popoverRef = useRef<HTMLDivElement>(null);
  const defaultReminderVal = () => {
    if (reminderTime) return toLocalInputVal(reminderTime);
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return toLocalInputVal(d.toISOString());
  };
  const [value, setValue] = useState(defaultReminderVal);

  useEffect(() => {
    if (reminderTime) setValue(toLocalInputVal(reminderTime));
    else { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); setValue(toLocalInputVal(d.toISOString())); }
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
            min={toLocalInputVal(new Date().toISOString())}
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

// ─── Find & Replace Panel ─────────────────────────────────────────────────────
function FindReplacePanel({
  content,
  onApply,
  onClose,
  textareaRef,
}: {
  content: string;
  onApply: (newContent: string) => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [find,    setFind]    = useState('');
  const [replace, setReplace] = useState('');
  const [idx,     setIdx]     = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { findInputRef.current?.focus(); }, []);

  const matches = useMemo(() => {
    if (!find) return [] as number[];
    const result: number[] = [];
    let i = 0;
    while (i < content.length) {
      const pos = content.indexOf(find, i);
      if (pos === -1) break;
      result.push(pos);
      i = pos + 1;
    }
    return result;
  }, [content, find]);

  const clampedIdx = matches.length ? Math.min(idx, matches.length - 1) : -1;

  useEffect(() => {
    if (clampedIdx === -1 || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(matches[clampedIdx], matches[clampedIdx] + find.length);
    ta.scrollTop = (ta.scrollHeight * (matches[clampedIdx] / content.length)) - ta.clientHeight / 2;
  }, [clampedIdx, matches, find, content, textareaRef]);

  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    setIdx(i => (i + dir + matches.length) % matches.length);
  };

  const doReplace = () => {
    if (clampedIdx === -1 || !find) return;
    const m = matches[clampedIdx];
    const next = content.slice(0, m) + replace + content.slice(m + find.length);
    onApply(next);
    setIdx(i => Math.min(i, matches.length - 2));
  };

  const doReplaceAll = () => {
    if (!find) return;
    onApply(content.split(find).join(replace));
    setIdx(0);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter')  { e.preventDefault(); e.shiftKey ? go(-1) : go(1); }
  };

  return (
    <div
      className="shrink-0 border-b border-border bg-card/50 px-3 py-2 space-y-2"
      onKeyDown={handleKey}
    >
      <div className="flex items-center gap-2">
        <Search size={12} className="text-muted-foreground/50 shrink-0" />
        <input
          ref={findInputRef}
          value={find}
          onChange={e => { setFind(e.target.value); setIdx(0); }}
          placeholder="Find…"
          className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        {find && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
            {matches.length ? `${clampedIdx + 1}/${matches.length}` : 'no results'}
          </span>
        )}
        <button onClick={() => go(-1)} disabled={!matches.length} title="Previous (Shift+Enter)"
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
          <ArrowUp size={11} />
        </button>
        <button onClick={() => go(1)} disabled={!matches.length} title="Next (Enter)"
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
          <ArrowDown size={11} />
        </button>
        <button onClick={onClose} title="Close (Esc)"
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors">
          <X size={11} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Replace size={12} className="text-muted-foreground/50 shrink-0" />
        <input
          value={replace}
          onChange={e => setReplace(e.target.value)}
          placeholder="Replace with…"
          className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button onClick={doReplace} disabled={!matches.length}
          className="shrink-0 h-5 px-2 rounded text-[10px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
          Replace
        </button>
        <button onClick={doReplaceAll} disabled={!find}
          className="shrink-0 h-5 px-2 rounded text-[10px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
          All
        </button>
      </div>
    </div>
  );
}

// ─── Reading Mode Overlay ─────────────────────────────────────────────────────
function ReadingModeOverlay({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  const cleanHtml = useMemo(() => {
    if (!content.trim()) return '';
    const raw = marked(content);
    return DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw));
  }, [content]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9000] bg-background/95 backdrop-blur-sm flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-primary" />
          <span className="text-sm font-semibold text-foreground truncate">{title}</span>
        </div>
        <button onClick={onClose} title="Exit reading mode (Esc)"
          className="flex items-center gap-1.5 h-7 px-3 rounded border border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <X size={12} /> Exit
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10">
          {content.trim() ? (
            <div
              className="prose dark:prose-invert prose-base max-w-none prose-headings:font-semibold prose-a:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
              dangerouslySetInnerHTML={{ __html: cleanHtml }}
            />
          ) : (
            <p className="text-muted-foreground/40 italic text-center">Nothing to read yet.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Lock Screen ──────────────────────────────────────────────────────────────
function LockScreen({
  noteId,
  lockHash,
  onUnlock,
  onRemoveLock,
}: {
  noteId: string;
  lockHash?: string;
  onUnlock: () => void;
  onRemoveLock: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const verify = async () => {
    if (!password) return;
    setChecking(true);
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    setChecking(false);
    if (hash === lockHash) { setError(''); onUnlock(); }
    else { setError('Incorrect password'); setPassword(''); inputRef.current?.focus(); }
  };

  const handleRemove = async () => {
    if (!password) return;
    setChecking(true);
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    setChecking(false);
    if (hash === lockHash) { setError(''); onRemoveLock(); }
    else { setError('Incorrect password'); }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 bg-background px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Lock size={24} className="text-primary" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-semibold text-foreground">This note is locked</p>
        <p className="text-[12px] text-muted-foreground/60">Enter the password to view its contents</p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') verify(); }}
          placeholder="Password…"
          className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring"
        />
        {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
        <button onClick={verify} disabled={checking || !password}
          className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5">
          {checking ? <Loader2 size={13} className="animate-spin" /> : <LockOpen size={13} />}
          Unlock
        </button>
        <button onClick={handleRemove} disabled={checking || !password}
          className="w-full h-7 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors">
          Remove lock permanently
        </button>
      </div>
    </div>
  );
}

// ─── Keyboard Shortcuts Modal ─────────────────────────────────────────────────
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const sections = [
    {
      title: 'Editor',
      shortcuts: [
        { keys: ['Ctrl', 'S'],   desc: 'Save note' },
        { keys: ['Ctrl', 'B'],   desc: 'Bold' },
        { keys: ['Ctrl', 'I'],   desc: 'Italic' },
        { keys: ['Ctrl', 'K'],   desc: 'Insert link' },
        { keys: ['Ctrl', 'F'],   desc: 'Find & Replace' },
      ],
    },
    {
      title: 'Navigation',
      shortcuts: [
        { keys: ['?'],           desc: 'Open shortcuts cheat sheet' },
        { keys: ['Escape'],      desc: 'Close panels / overlays' },
      ],
    },
    {
      title: 'Find & Replace',
      shortcuts: [
        { keys: ['Enter'],       desc: 'Next match' },
        { keys: ['Shift', 'Enter'], desc: 'Previous match' },
        { keys: ['Escape'],      desc: 'Close find bar' },
      ],
    },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md mx-4 bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Keyboard size={14} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">Keyboard Shortcuts</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground/50 hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {sections.map(section => (
            <div key={section.title}>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold mb-2">{section.title}</p>
              <div className="space-y-1">
                {section.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-[12px] text-foreground/80">{s.desc}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <span key={ki} className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono text-foreground/70">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground/40 text-center">Press <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[9px] font-mono">?</kbd> anywhere outside an input to open this</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Main Editor ─────────────────────────────────────────────────────────────
export function Editor({ onBack }: { onBack?: () => void }) {
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
  const togglePinned   = useNotesStore(s => s.togglePinned);
  const lockNote       = useNotesStore(s => s.lockNote);
  const removeLock     = useNotesStore(s => s.removeLock);
  const sessionUnlock  = useNotesStore(s => s.sessionUnlock);
  const setNoteStatus  = useNotesStore(s => s.setNoteStatus);
  const setTags        = useNotesStore(s => s.setTags);
  const trashNote      = useNotesStore(s => s.trashNote);
  const restoreNote    = useNotesStore(s => s.restoreNote);
  const toggleTask     = useNotesStore(s => s.toggleTask);

  const userId             = useNotesStore(s => s.userId);
  const encryptionKey      = useNotesStore(s => s.encryptionKey);
  const vaultHandle        = useNotesStore(s => s.vaultHandle);
  const sessionUnlockedIds = useNotesStore(s => s.sessionUnlockedIds);
  const setReminder        = useNotesStore(s => s.setReminder);

  const [showPreview,        setShowPreview]        = useState(false);
  const [showHistory,        setShowHistory]        = useState(false);
  const [showFind,           setShowFind]           = useState(false);
  const [showReading,        setShowReading]        = useState(false);
  const [showShortcuts,      setShowShortcuts]      = useState(false);
  const [showLockModal,      setShowLockModal]      = useState(false);
  const [lockPassword,       setLockPassword]       = useState('');
  const [lockError,          setLockError]          = useState('');
  const [ctxMenu,            setCtxMenu]            = useState<CtxPos | null>(null);
  const [selectionBar,       setSelectionBar]       = useState<{ x: number; y: number } | null>(null);
  const [dragOver,           setDragOver]           = useState(false);
  const [titleValue,         setTitleValue]         = useState('');
  // Mobile overflow menu
  const [showMoreMenu,       setShowMoreMenu]       = useState(false);
  const [showMobileReminder, setShowMobileReminder] = useState(false);
  const [mobileReminderVal,  setMobileReminderVal]  = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return toLocalInputVal(d.toISOString()); });
  const moreMenuRef          = useRef<HTMLDivElement>(null);
  const titleRef             = useRef<HTMLInputElement>(null);
  const textareaRef          = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef         = useRef<ReturnType<typeof setTimeout>>();
  // key bumped on drop so AttachmentStrip re-mounts and reloads its file list
  const [dropKey,       setDropKey]       = useState(0);

  // Compute activeNote locally — notes is a stable ref until refreshNotes() replaces it
  const activeNote = useMemo(
    () => notes.find(n => n.id === activeNoteId) ?? null,
    [notes, activeNoteId]
  );

  const isTrash         = activeSection.type === 'trash';
  const isArchive       = activeSection.type === 'archive';
  const isReadOnly      = isTrash;
  const isSessionLocked = (activeNote?.locked && !sessionUnlockedIds.has(activeNote?.id ?? '')) ?? false;

  // Export helpers
  const handleExportMd = useCallback(() => {
    if (!activeNote || !activeContent) return;
    const blob = new Blob([activeContent], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${activeNote.title || 'note'}.md`; a.click();
    URL.revokeObjectURL(url);
  }, [activeNote, activeContent]);

  const handleCopyContent = useCallback(() => {
    if (!activeContent) return;
    navigator.clipboard.writeText(activeContent).catch(() => {});
  }, [activeContent]);

  // Lock modal submit
  const handleLockSubmit = useCallback(async () => {
    if (!lockPassword.trim() || !activeNoteId) return;
    await lockNote(activeNoteId, lockPassword);
    setLockPassword('');
    setLockError('');
    setShowLockModal(false);
  }, [lockPassword, activeNoteId, lockNote]);

  useEffect(() => {
    if (activeNote) setTitleValue(activeNote.title);
  }, [activeNoteId, activeNote?.title]);

  // Close mobile more-menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  // Sync mobile reminder value when reminder time changes
  useEffect(() => {
    if (activeNote?.reminderTime) {
      setMobileReminderVal(toLocalInputVal(activeNote.reminderTime));
    } else {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
      setMobileReminderVal(toLocalInputVal(d.toISOString()));
    }
  }, [activeNote?.reminderTime, activeNoteId]);

  // Autosave 1.5s after last keystroke
  const handleContentChange = useCallback((content: string) => {
    updateContent(content);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveActiveNote(), 1500);
  }, [updateContent, saveActiveNote]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Drag-and-drop file handler for the whole editor pane
  const handleEditorDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!vaultHandle || !activeNoteId || isReadOnly) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const md = `\n![${file.name}](${dataUrl})\n`;
          if (textareaRef.current) insertAtCursor(textareaRef.current, md, handleContentChange);
        };
        reader.readAsDataURL(file);
      } else {
        const data = new Uint8Array(await file.arrayBuffer());
        await writeAttachment(vaultHandle, activeNoteId, file.name, data, encryptionKey);
      }
    }
    setDropKey(k => k + 1); // force AttachmentStrip to re-mount + reload
  }, [vaultHandle, activeNoteId, isReadOnly, encryptionKey, handleContentChange]);

  // Ctrl+S manual save / Ctrl+F find / ? shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveActiveNote(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setShowFind(p => !p); return; }
      // '?' shortcut — only when not typing in an input/textarea
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcuts(p => !p);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveNote]);

  // ── Selection toolbar: show when text is highlighted ──────────────────────
  const handleTextareaMouseUp = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Small delay so browser finalises the selection
    const cx = e.clientX, cy = e.clientY;
    setTimeout(() => {
      if (ta.selectionStart !== ta.selectionEnd) setSelectionBar({ x: cx, y: cy });
      else setSelectionBar(null);
    }, 30);
  }, []);

  const handleTextareaKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) {
      const rect = ta.getBoundingClientRect();
      setSelectionBar({ x: rect.left + rect.width / 2, y: rect.top + 20 });
    } else {
      setSelectionBar(null);
    }
  }, []);

  // Dismiss selection toolbar on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Keep toolbar if clicking inside it (handled by onMouseDown+preventDefault there)
      if (!textareaRef.current?.contains(target)) setSelectionBar(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Word / character count ─────────────────────────────────────────────────
  const wordCount = useMemo(() => {
    if (!activeContent?.trim()) return { words: 0, chars: 0 };
    const words = activeContent.trim().split(/\s+/).filter(Boolean).length;
    const chars = activeContent.length;
    return { words, chars };
  }, [activeContent]);

  // Memoize the markdown render so it only re-runs when content changes
  const cleanHtml = useMemo(() => {
    if (!activeContent?.trim()) return '';
    const raw = marked(activeContent);
    const sanitized = DOMPurify.sanitize(
      typeof raw === 'string' ? raw : String(raw),
      { ADD_TAGS: ['input'], ADD_ATTR: ['type', 'checked', 'disabled'] }
    );
    // Remove disabled so checkboxes are clickable in preview
    return sanitized.replace(/<input([^>]*)\sdisabled/gi, '<input$1');
  }, [activeContent]);

  // Click handler for interactive checkboxes in preview
  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' || target.getAttribute('type') !== 'checkbox') return;
    e.preventDefault();
    const container = e.currentTarget as HTMLDivElement;
    const allBoxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const nthBox = allBoxes.indexOf(target as HTMLInputElement);
    if (nthBox === -1 || !activeNoteId || !activeContent) return;
    // Map the nth checkbox to its line in the raw markdown
    const lines = activeContent.split('\n');
    let count = -1;
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (/^\s*-\s+\[[ x]\]/i.test(lines[lineIdx])) {
        count++;
        if (count === nthBox) {
          toggleTask(`${activeNoteId}::${lineIdx}`);
          break;
        }
      }
    }
  }, [activeContent, activeNoteId, toggleTask]);

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
    <div
      className="flex-1 flex flex-col bg-background h-full overflow-hidden relative"
      onDragOver={e => { e.preventDefault(); if (!isReadOnly) setDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleEditorDrop}
    >
      {/* Drag-over overlay */}
      {dragOver && !isReadOnly && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-none pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip size={28} strokeWidth={1.5} />
            <p className="text-sm font-medium">Drop files to attach</p>
            <p className="text-xs opacity-70">Images embed inline · Other files stored in vault</p>
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <header className="shrink-0 border-b border-border bg-card/20 px-4 pt-3 pb-2 space-y-1.5">
        {/* Title row */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Back button — mobile only */}
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors -ml-1"
              title="Back to notes"
            >
              <ChevronLeft size={20} />
            </button>
          )}
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

          {/* ── Desktop: all action buttons inline ─────────────────────── */}
          <div className="hidden md:flex items-center gap-1 shrink-0">
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
            {!isTrash && !isArchive && (
              <button onClick={() => activeNote && togglePinned(activeNote.id)}
                title={activeNote?.isPinned ? "Unpin" : "Pin to top"}
                className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                  activeNote?.isPinned ? "bg-muted text-primary border-primary/30" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
                {activeNote?.isPinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
            )}
            {!isTrash && !isArchive && (
              <button
                onClick={() => {
                  if (activeNote?.locked) {
                    if (!isSessionLocked && activeNote.id) useNotesStore.getState().sessionLock(activeNote.id);
                  } else {
                    setLockPassword(''); setLockError(''); setShowLockModal(true);
                  }
                }}
                title={activeNote?.locked ? (isSessionLocked ? "Note is locked" : "Lock now") : "Lock note"}
                className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                  activeNote?.locked ? "bg-muted text-amber-500 border-amber-500/30" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
                {activeNote?.locked ? <Lock size={11} /> : <LockOpen size={11} />}
              </button>
            )}
            {!isSessionLocked && (
              <button onClick={handleExportMd} title="Export as .md"
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors border border-border">
                <FileDown size={11} />
              </button>
            )}
            {!isSessionLocked && (
              <button onClick={() => setShowReading(true)} title="Reading mode"
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors border border-border">
                <BookOpen size={11} />
              </button>
            )}
            <button onClick={() => setShowHistory(p => !p)} title="Version history"
              className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                showHistory ? "bg-muted text-foreground" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
              <History size={11} />
            </button>
            <button onClick={() => setShowPreview(p => !p)} title="Toggle preview"
              className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                showPreview ? "bg-muted text-foreground" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
              {showPreview ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            {!isSessionLocked && (
              <button onClick={() => setShowFind(p => !p)} title="Find & Replace (Ctrl+F)"
                className={cn("h-6 w-6 rounded flex items-center justify-center transition-colors border border-border",
                  showFind ? "bg-muted text-foreground" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted")}>
                <Search size={11} />
              </button>
            )}
            <button onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)"
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors border border-border">
              <Keyboard size={11} />
            </button>
            <button onClick={saveActiveNote} disabled={!isDirty || isReadOnly}
              title={isDirty ? "Save (Ctrl+S)" : "Saved"}
              className={cn("h-6 px-2 rounded flex items-center gap-1 text-[11px] border transition-all",
                isDirty ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" : "border-border text-muted-foreground/30 cursor-default")}>
              <Save size={10} />
              {isDirty ? "Save" : "Saved"}
            </button>
          </div>

          {/* ── Mobile: unsaved indicator + ⋯ overflow menu ─────────────── */}
          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            {isDirty && !isReadOnly && (
              <button onClick={saveActiveNote}
                className="h-7 px-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-[11px] flex items-center gap-1">
                <Save size={10} /> Save
              </button>
            )}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(p => !p)}
                className={cn("h-7 w-7 flex items-center justify-center rounded-lg border transition-colors",
                  showMoreMenu ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground/60 hover:text-foreground hover:bg-muted")}>
                <MoreHorizontal size={15} />
              </button>

              {showMoreMenu && (
                <div className="absolute right-0 top-9 z-[300] w-52 bg-popover border border-border rounded-xl shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-100">
                  {/* Reminder */}
                  {!isReadOnly && (
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowMobileReminder(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <Bell size={13} className={activeNote.hasReminder ? "text-primary" : "text-muted-foreground/50"} />
                      {activeNote.hasReminder ? `Reminder: ${activeNote.reminderTime ? format(new Date(activeNote.reminderTime), 'MMM d, h:mm a') : ''}` : 'Set reminder'}
                    </button>
                  )}

                  <div className="my-1 border-t border-border/60" />

                  {/* Archive / Restore */}
                  {!isTrash && !isArchive && (
                    <button onClick={() => { setNoteStatus(activeNote.id, 'archived'); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <Archive size={13} className="text-muted-foreground/50" /> Archive
                    </button>
                  )}
                  {(isArchive || isTrash) && (
                    <button onClick={() => { restoreNote(activeNote.id); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <RotateCcw size={13} className="text-muted-foreground/50" /> Restore
                    </button>
                  )}

                  {/* Trash */}
                  {!isTrash && !isArchive && (
                    <button onClick={() => { trashNote(activeNote.id); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-destructive hover:bg-destructive/10 transition-colors text-left">
                      <Trash2 size={13} /> Move to trash
                    </button>
                  )}

                  <div className="my-1 border-t border-border/60" />

                  {/* Pin */}
                  {!isTrash && !isArchive && (
                    <button onClick={() => { togglePinned(activeNote.id); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      {activeNote.isPinned ? <PinOff size={13} className="text-primary" /> : <Pin size={13} className="text-muted-foreground/50" />}
                      {activeNote.isPinned ? 'Unpin' : 'Pin to top'}
                    </button>
                  )}

                  {/* Lock */}
                  {!isTrash && !isArchive && (
                    <button onClick={() => {
                      setShowMoreMenu(false);
                      if (activeNote.locked) {
                        if (!isSessionLocked) useNotesStore.getState().sessionLock(activeNote.id);
                      } else {
                        setLockPassword(''); setLockError(''); setShowLockModal(true);
                      }
                    }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      {activeNote.locked ? <Lock size={13} className="text-amber-500" /> : <LockOpen size={13} className="text-muted-foreground/50" />}
                      {activeNote.locked ? (isSessionLocked ? 'Locked' : 'Lock now') : 'Lock note'}
                    </button>
                  )}

                  <div className="my-1 border-t border-border/60" />

                  {/* Export */}
                  {!isSessionLocked && (
                    <button onClick={() => { handleExportMd(); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <FileDown size={13} className="text-muted-foreground/50" /> Export as .md
                    </button>
                  )}
                  {!isSessionLocked && (
                    <button onClick={() => { handleCopyContent(); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <Copy size={13} className="text-muted-foreground/50" /> Copy to clipboard
                    </button>
                  )}

                  <div className="my-1 border-t border-border/60" />

                  {/* View options */}
                  {!isSessionLocked && (
                    <button onClick={() => { setShowReading(true); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <BookOpen size={13} className="text-muted-foreground/50" /> Reading mode
                    </button>
                  )}
                  <button onClick={() => { setShowPreview(p => !p); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                    {showPreview ? <EyeOff size={13} className="text-primary" /> : <Eye size={13} className="text-muted-foreground/50" />}
                    {showPreview ? 'Hide preview' : 'Split preview'}
                  </button>
                  <button onClick={() => { setShowHistory(p => !p); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                    <History size={13} className={showHistory ? "text-primary" : "text-muted-foreground/50"} />
                    Version history
                  </button>
                  {!isSessionLocked && (
                    <button onClick={() => { setShowFind(p => !p); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                      <Search size={13} className={showFind ? "text-primary" : "text-muted-foreground/50"} /> Find & Replace
                    </button>
                  )}
                  <button onClick={() => { setShowShortcuts(true); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-popover-foreground hover:bg-muted transition-colors text-left">
                    <Keyboard size={13} className="text-muted-foreground/50" /> Keyboard shortcuts
                  </button>
                </div>
              )}
            </div>
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

      {/* ── Markdown Toolbar ── */}
      {!isReadOnly && !isSessionLocked && (
        <MarkdownToolbar textareaRef={textareaRef} onChange={handleContentChange} />
      )}

      {/* ── Find & Replace Panel ── */}
      {showFind && !isReadOnly && !isSessionLocked && (
        <FindReplacePanel
          content={activeContent}
          onApply={handleContentChange}
          onClose={() => setShowFind(false)}
          textareaRef={textareaRef}
        />
      )}

      {/* ── Attachment Strip ── */}
      {!isReadOnly && vaultHandle && activeNoteId && (
        <AttachmentStrip
          key={`${activeNoteId}-${dropKey}`}
          noteId={activeNoteId}
          vault={vaultHandle}
          encryptionKey={encryptionKey}
          textareaRef={textareaRef}
          onContentChange={handleContentChange}
        />
      )}

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

      {/* ── Editor / Preview / History ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Lock screen — replaces editor when note is locked */}
        {isSessionLocked ? (
          <LockScreen
            noteId={activeNoteId}
            lockHash={activeNote.lockHash}
            onUnlock={() => sessionUnlock(activeNoteId)}
            onRemoveLock={() => removeLock(activeNoteId)}
          />
        ) : (
          <>
            {/* Writing area (hidden when preview-only on small screens) */}
            <div className={cn("flex-1 flex flex-col min-w-0", showPreview && "hidden lg:flex lg:w-1/2 lg:flex-none")}>
              <textarea
                ref={textareaRef}
                value={activeContent}
                onChange={e => handleContentChange(e.target.value)}
                disabled={isReadOnly}
                placeholder={isReadOnly ? "(Note is in trash — restore to edit)" : "Start writing in Markdown..."}
                spellCheck={true}
                onKeyDown={!isReadOnly ? e => handleListContinuation(e, handleContentChange) : undefined}
                onMouseUp={!isReadOnly ? handleTextareaMouseUp : undefined}
                onKeyUp={!isReadOnly ? handleTextareaKeyUp : undefined}
                onContextMenu={!isReadOnly ? e => { e.preventDefault(); setSelectionBar(null); setCtxMenu({ x: e.clientX, y: e.clientY }); } : undefined}
                className="flex-1 w-full bg-transparent px-6 py-4 resize-none outline-none font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/30 disabled:opacity-50"
              />
              {/* Word count + copy action */}
              {!isReadOnly && (
                <div className="shrink-0 flex items-center justify-end gap-3 px-4 py-1 border-t border-border/40 bg-card/10">
                  <button onClick={handleCopyContent} title="Copy note as Markdown"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                    <Copy size={9} /> Copy
                  </button>
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                    {wordCount.words.toLocaleString()} {wordCount.words === 1 ? 'word' : 'words'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/30 tabular-nums">
                    {wordCount.chars.toLocaleString()} chars
                  </span>
                </div>
              )}
            </div>

            {showPreview && (
              <div className="flex-1 border-l border-border bg-card/10 overflow-y-auto px-6 py-4">
                {activeContent.trim() ? (
                  <div
                    className="prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-a:text-primary prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded [&_input[type=checkbox]]:accent-[hsl(var(--primary))] [&_input[type=checkbox]]:cursor-pointer"
                    onClick={!isReadOnly ? handlePreviewClick : undefined}
                    dangerouslySetInnerHTML={{ __html: cleanHtml }}
                  />
                ) : (
                  <p className="text-muted-foreground/30 italic text-sm">Preview will appear here...</p>
                )}
              </div>
            )}

            {/* Version history side panel */}
            {showHistory && userId && (
              <VersionHistory
                noteId={activeNoteId}
                userId={userId}
                encryptionKey={encryptionKey}
                onRestore={content => { handleContentChange(content); saveActiveNote(); }}
                onClose={() => setShowHistory(false)}
              />
            )}
          </>
        )}
      </div>

      {/* Selection floating toolbar */}
      {selectionBar && !isReadOnly && !isSessionLocked && (
        <SelectionFloatingToolbar
          textareaRef={textareaRef}
          onChange={handleContentChange}
          anchorPos={selectionBar}
          onDismiss={() => setSelectionBar(null)}
        />
      )}

      {/* Textarea right-click context menu */}
      {ctxMenu && (
        <TextareaContextMenu
          pos={ctxMenu}
          onClose={() => setCtxMenu(null)}
          textareaRef={textareaRef}
          onChange={handleContentChange}
        />
      )}

      {/* ── Reading mode overlay ── */}
      {showReading && (
        <ReadingModeOverlay
          title={activeNote.title}
          content={activeContent}
          onClose={() => setShowReading(false)}
        />
      )}

      {/* ── Shortcuts modal ── */}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* ── Mobile reminder modal (fixed center, avoids off-screen popovers) ── */}
      {showMobileReminder && activeNote && createPortal(
        <div
          className="fixed inset-0 z-[9300] flex items-end sm:items-center justify-center bg-black/50 px-4 pb-safe-or-6"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowMobileReminder(false); }}
        >
          <div className="w-full max-w-xs bg-popover border border-border rounded-2xl shadow-2xl p-4 space-y-3 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 mb-4 sm:mb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-primary" />
                <p className="text-[13px] font-semibold text-foreground">Set reminder</p>
              </div>
              <button onClick={() => setShowMobileReminder(false)} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                <X size={14} />
              </button>
            </div>
            <input
              type="datetime-local"
              value={mobileReminderVal}
              min={toLocalInputVal(new Date().toISOString())}
              onChange={e => setMobileReminderVal(e.target.value)}
              className="w-full text-[13px] bg-muted border border-border rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (mobileReminderVal) {
                    setReminder(activeNote.id, new Date(mobileReminderVal).toISOString());
                    setShowMobileReminder(false);
                  }
                }}
                disabled={!mobileReminderVal}
                className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5">
                <Check size={13} /> Save
              </button>
              {activeNote.hasReminder && (
                <button
                  onClick={() => { setReminder(activeNote.id, null); setShowMobileReminder(false); }}
                  className="flex-1 h-9 rounded-lg border border-destructive/40 text-destructive text-[13px] hover:bg-destructive/10 transition-colors flex items-center justify-center gap-1.5">
                  <X size={13} /> Clear
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showLockModal && createPortal(
        <div
          className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={e => { if (e.target === e.currentTarget) { setShowLockModal(false); setLockPassword(''); setLockError(''); } }}
        >
          <div className="w-full max-w-xs mx-4 bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-primary" />
              <p className="text-sm font-semibold text-foreground">Lock this note</p>
            </div>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Set a password to lock this note. The vault's AES-256 encryption still protects the content — this lock adds an extra access gate within the app.
            </p>
            <input
              type="password"
              value={lockPassword}
              onChange={e => { setLockPassword(e.target.value); setLockError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleLockSubmit(); if (e.key === 'Escape') { setShowLockModal(false); setLockPassword(''); } }}
              placeholder="Choose a password…"
              autoFocus
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring"
            />
            {lockError && <p className="text-[11px] text-destructive">{lockError}</p>}
            <div className="flex gap-2">
              <button onClick={handleLockSubmit} disabled={!lockPassword.trim()}
                className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5">
                <Lock size={13} /> Lock note
              </button>
              <button onClick={() => { setShowLockModal(false); setLockPassword(''); setLockError(''); }}
                className="h-9 px-4 rounded-lg border border-border text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
