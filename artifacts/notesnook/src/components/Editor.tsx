import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { cn } from '../lib/utils';
import { loadVersions, NoteVersion } from '../lib/versions';
import {
  writeAttachment, readAttachment, listAttachments, deleteAttachment,
  AttachmentInfo, isImageMime, formatBytes,
} from '../lib/attachments';

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
  const setNoteStatus  = useNotesStore(s => s.setNoteStatus);
  const setTags        = useNotesStore(s => s.setTags);
  const trashNote      = useNotesStore(s => s.trashNote);
  const restoreNote    = useNotesStore(s => s.restoreNote);
  const toggleTask     = useNotesStore(s => s.toggleTask);

  const userId        = useNotesStore(s => s.userId);
  const encryptionKey = useNotesStore(s => s.encryptionKey);
  const vaultHandle   = useNotesStore(s => s.vaultHandle);

  const [showPreview,  setShowPreview]  = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);
  const [ctxMenu,      setCtxMenu]      = useState<CtxPos | null>(null);
  const [dragOver,     setDragOver]     = useState(false);
  const [titleValue,   setTitleValue]   = useState('');
  const titleRef        = useRef<HTMLInputElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout>>();
  // key bumped on drop so AttachmentStrip re-mounts and reloads its file list
  const [dropKey,      setDropKey]      = useState(0);

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

      {/* ── Markdown Toolbar ── */}
      {!isReadOnly && (
        <MarkdownToolbar textareaRef={textareaRef} onChange={handleContentChange} />
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
        {/* Writing area (hidden when preview-only on small screens) */}
        <div className={cn("flex-1 flex flex-col min-w-0", showPreview && "hidden lg:flex lg:w-1/2 lg:flex-none")}>
          <textarea
            ref={textareaRef}
            value={activeContent}
            onChange={e => handleContentChange(e.target.value)}
            disabled={isReadOnly}
            placeholder={isReadOnly ? "(Note is in trash — restore to edit)" : "Start writing in Markdown..."}
            spellCheck={true}
            onContextMenu={!isReadOnly ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); } : undefined}
            className="flex-1 w-full bg-transparent px-6 py-4 resize-none outline-none font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/30 disabled:opacity-50"
          />
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
      </div>

      {/* Textarea right-click context menu */}
      {ctxMenu && (
        <TextareaContextMenu
          pos={ctxMenu}
          onClose={() => setCtxMenu(null)}
          textareaRef={textareaRef}
          onChange={handleContentChange}
        />
      )}
    </div>
  );
}
