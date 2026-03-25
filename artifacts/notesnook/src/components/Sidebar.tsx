import { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileText, Star, Archive, Trash2, Tag, ChevronDown, ChevronRight,
  Plus, FolderOpen, FolderX, Sun, Moon, Settings, Zap, LogOut, Search,
  Download, CheckCircle2, ListTodo, Clock, Calendar, CheckCheck,
  FilePlus, RotateCcw, Trash, TagIcon,
  Lock, LockOpen, ShieldCheck, X, Cloud,
} from 'lucide-react';
import { useNotesStore, SidebarSection, STORAGE_LIMIT_BYTES } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { AccentColor, getAllTags } from '../lib/metadata';
import { selectTaskCounts } from '../lib/tasks';
import { usePWAInstall } from '../lib/usePWAInstall';
import { cn } from '../lib/utils';
import { SettingsPanel } from './SettingsPanel';

const ACCENT_COLORS: { id: AccentColor; label: string; hsl: string }[] = [
  { id: 'violet', label: 'Violet', hsl: '252 87% 67%' },
  { id: 'indigo', label: 'Indigo', hsl: '238 75% 62%' },
  { id: 'blue',   label: 'Blue',   hsl: '217 91% 60%' },
  { id: 'cyan',   label: 'Cyan',   hsl: '188 78% 46%' },
  { id: 'teal',   label: 'Teal',   hsl: '174 72% 42%' },
  { id: 'green',  label: 'Green',  hsl: '142 71% 42%' },
  { id: 'amber',  label: 'Amber',  hsl: '38 90% 50%'  },
  { id: 'orange', label: 'Orange', hsl: '24 95% 55%'  },
  { id: 'rose',   label: 'Rose',   hsl: '347 87% 60%' },
  { id: 'pink',   label: 'Pink',   hsl: '315 85% 60%' },
];

export function Sidebar({ onOpenCommandPalette, onMobileClose }: {
  onOpenCommandPalette: () => void;
  onMobileClose?: () => void;
}) {
  const { user, logout } = useAuth();
  const { canInstall, isInstalled, install } = usePWAInstall();

  const activeSection  = useNotesStore(s => s.activeSection);
  const vaultHandle    = useNotesStore(s => s.vaultHandle);
  const userId         = useNotesStore(s => s.userId);
  const theme          = useNotesStore(s => s.theme);
  const accentColor    = useNotesStore(s => s.accentColor);
  const notes          = useNotesStore(s => s.notes);
  const metadata       = useNotesStore(s => s.metadata);
  const tasks          = useNotesStore(s => s.tasks);

  const setActiveSection      = useNotesStore(s => s.setActiveSection);
  const createNewNote         = useNotesStore(s => s.createNewNote);
  const permanentlyDeleteNote = useNotesStore(s => s.permanentlyDeleteNote);
  const setNoteStatus         = useNotesStore(s => s.setNoteStatus);
  const setTags               = useNotesStore(s => s.setTags);
  const toggleFavorite        = useNotesStore(s => s.toggleFavorite);
  const createTaskNote        = useNotesStore(s => s.createTaskNote);
  const setTaskDueDate        = useNotesStore(s => s.setTaskDueDate);
  const openNewVault          = useNotesStore(s => s.openNewVault);
  const disconnectVault       = useNotesStore(s => s.disconnectVault);
  const toggleTheme           = useNotesStore(s => s.toggleTheme);
  const setAccentColor        = useNotesStore(s => s.setAccentColor);
  const isVaultEncrypted      = useNotesStore(s => s.isVaultEncrypted);
  const encryptionKey         = useNotesStore(s => s.encryptionKey);
  const enableEncryption      = useNotesStore(s => s.enableEncryption);
  const disableEncryption     = useNotesStore(s => s.disableEncryption);
  const lockVault             = useNotesStore(s => s.lockVault);

  const noteSizes  = useNotesStore(s => s.noteSizes);

  const tags = useMemo(() => getAllTags(metadata, notes), [metadata, notes]);
  const counts = useMemo(() => ({
    all:       notes.filter(n => n.status === 'active').length,
    favorites: notes.filter(n => n.status === 'active' && n.isFavorite).length,
    archive:   notes.filter(n => n.status === 'archived').length,
    trash:     notes.filter(n => n.status === 'trashed').length,
  }), [notes]);
  const taskCounts = useMemo(() => selectTaskCounts(tasks), [tasks]);
  const totalStorageBytes = useMemo(() => Object.values(noteSizes).reduce((a, b) => a + b, 0), [noteSizes]);

  const [tagsOpen,        setTagsOpen]        = useState(true);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [syncPanelOpen,   setSyncPanelOpen]   = useState(false);
  const [showEncryption,  setShowEncryption]  = useState(false);
  const [encPwd,          setEncPwd]          = useState('');
  const [encPwd2,         setEncPwd2]         = useState('');
  const [encError,        setEncError]        = useState('');
  const [encLoading,      setEncLoading]      = useState(false);

  // ─── Context menu ─────────────────────────────────────────────────────────
  type CtxItem = { label: string; icon: React.ReactNode; action: () => void; danger?: boolean };
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const openCtx = (e: React.MouseEvent, items: CtxItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const runCtx = (action: () => void) => { setCtxMenu(null); action(); };

  const isSectionActive = (s: SidebarSection) => {
    if (s.type === 'tag' && activeSection.type === 'tag')
      return (activeSection as any).tag === (s as any).tag;
    return activeSection.type === s.type;
  };

  type NavItem = { id: SidebarSection; icon: React.ReactNode; label: string; count: number; ctx: CtxItem[] };

  const noteItems: NavItem[] = [
    {
      id: { type: 'all' }, icon: <FileText size={13} />, label: 'Notes', count: counts.all,
      ctx: [
        { label: 'New Note', icon: <FilePlus size={12} />, action: () => createNewNote() },
      ],
    },
    {
      id: { type: 'favorites' }, icon: <Star size={13} />, label: 'Favorites', count: counts.favorites,
      ctx: [
        { label: 'New Favorite Note', icon: <Star size={12} />, action: async () => {
          await createNewNote();
          const newest = useNotesStore.getState().notes.find(n => n.status === 'active');
          if (newest) toggleFavorite(newest.id);
        }},
      ],
    },
    {
      id: { type: 'archive' }, icon: <Archive size={13} />, label: 'Archive', count: counts.archive,
      ctx: [
        { label: 'Restore All', icon: <RotateCcw size={12} />, action: () => {
          notes.filter(n => n.status === 'archived').forEach(n => setNoteStatus(n.id, 'active'));
        }},
        { label: 'Delete All', icon: <Trash size={12} />, danger: true, action: () => {
          if (confirm('Permanently delete all archived notes? This cannot be undone.'))
            notes.filter(n => n.status === 'archived').forEach(n => permanentlyDeleteNote(n.id));
        }},
      ],
    },
    {
      id: { type: 'trash' }, icon: <Trash2 size={13} />, label: 'Trash', count: counts.trash,
      ctx: [
        { label: 'Empty Trash', icon: <Trash size={12} />, danger: true, action: () => {
          if (confirm('Permanently delete all trashed notes? This cannot be undone.'))
            notes.filter(n => n.status === 'trashed').forEach(n => permanentlyDeleteNote(n.id));
        }},
      ],
    },
  ];

  const taskItems: NavItem[] = [
    {
      id: { type: 'tasks-inbox' }, icon: <ListTodo size={13} />, label: 'Inbox', count: taskCounts.inbox,
      ctx: [
        { label: 'New Task Note', icon: <FilePlus size={12} />, action: () => createTaskNote() },
      ],
    },
    {
      id: { type: 'tasks-today' }, icon: <Clock size={13} />, label: 'Today', count: taskCounts.today,
      ctx: [
        { label: 'New Task Note (Due Today)', icon: <FilePlus size={12} />, action: async () => {
          await createTaskNote();
          const state = useNotesStore.getState();
          const newestNote = state.notes.find(n => n.status === 'active');
          if (!newestNote) return;
          const todayTasks = Object.values(state.tasks).filter(t => t.noteId === newestNote.id);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          todayTasks.forEach(t => setTaskDueDate(t.id, today.toISOString()));
        }},
      ],
    },
    {
      id: { type: 'tasks-upcoming' }, icon: <Calendar size={13} />, label: 'Upcoming', count: taskCounts.upcoming,
      ctx: [
        { label: 'New Task Note', icon: <FilePlus size={12} />, action: () => createTaskNote() },
      ],
    },
    {
      id: { type: 'tasks-done' }, icon: <CheckCheck size={13} />, label: 'Completed', count: taskCounts.done,
      ctx: [
        { label: 'Clear Completed Notes', icon: <Trash size={12} />, danger: true, action: () => {
          if (confirm('Permanently delete all notes that only contain completed tasks? This cannot be undone.')) {
            const state = useNotesStore.getState();
            notes.filter(n => n.status === 'active').forEach(n => {
              const noteTasks = Object.values(state.tasks).filter(t => t.noteId === n.id);
              if (noteTasks.length > 0 && noteTasks.every(t => t.completed))
                permanentlyDeleteNote(n.id);
            });
          }
        }},
      ],
    },
  ];

  return (
    <>
    <aside className="w-72 md:w-[200px] shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border select-none overflow-hidden">
      {/* Branding */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-sidebar-border">
        <div className="w-5 h-5 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Zap size={10} className="text-primary" />
        </div>
        <span className="font-semibold text-[12px] tracking-tight text-sidebar-foreground">Ballpoint</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={toggleTheme} title="Toggle theme"
            className="w-7 h-7 md:w-5 md:h-5 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            {theme === 'dark' ? <Sun size={13} className="md:w-[11px] md:h-[11px]" /> : <Moon size={13} className="md:w-[11px] md:h-[11px]" />}
          </button>
          <button onClick={() => setSyncPanelOpen(true)} title="Cloud Sync"
            className="w-7 h-7 md:w-5 md:h-5 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            <Cloud size={13} className="md:w-[11px] md:h-[11px]" />
          </button>
          <button onClick={() => setSettingsOpen(p => !p)} title="Settings"
            className={cn("w-7 h-7 md:w-5 md:h-5 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
              settingsOpen && "bg-sidebar-accent text-sidebar-foreground")}>
            <Settings size={13} className="md:w-[11px] md:h-[11px]" />
          </button>
          {/* Close button — mobile drawer only */}
          {onMobileClose && (
            <button onClick={onMobileClose} title="Close menu"
              className="md:hidden w-7 h-7 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors ml-1">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="border-b border-sidebar-border bg-sidebar overflow-y-auto max-h-[60vh]">
          {/* Account card — top */}
          {user && (
            <div className="mx-3 mt-3 mb-2 rounded-xl overflow-hidden border border-sidebar-border/60">
              <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[13px] font-bold uppercase shrink-0 shadow-sm">
                  {user.email[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-sidebar-foreground truncate">{user.email}</p>
                  <p className="text-[10px] text-sidebar-foreground/50">Personal account</p>
                </div>
              </div>
              <button onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-destructive/80 hover:bg-destructive/8 hover:text-destructive transition-colors border-t border-sidebar-border/40">
                <LogOut size={11} /> Sign out
              </button>
            </div>
          )}

          <div className="px-3 pb-3 space-y-3">

            {/* Theme color */}
            <div>
              <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-2 font-semibold">Accent Color</p>
              <div className="flex flex-wrap gap-1.5">
                {ACCENT_COLORS.map(c => (
                  <button key={c.id} onClick={() => setAccentColor(c.id)} title={c.label}
                    style={{ backgroundColor: `hsl(${c.hsl})` }}
                    className={cn(
                      "w-5 h-5 rounded-full transition-all flex items-center justify-center shadow-sm",
                      accentColor === c.id
                        ? "ring-2 ring-offset-1 ring-offset-sidebar scale-110"
                        : "opacity-70 hover:opacity-100 hover:scale-105"
                    )}>
                    {accentColor === c.id && <CheckCircle2 size={10} className="text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Storage usage */}
            {vaultHandle && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 font-semibold">Storage</p>
                  <span className={cn("text-[9px] tabular-nums font-medium",
                    totalStorageBytes >= STORAGE_LIMIT_BYTES * 0.9 ? "text-destructive" :
                    totalStorageBytes >= STORAGE_LIMIT_BYTES * 0.7 ? "text-amber-500" :
                    "text-sidebar-foreground/40")}>
                    {totalStorageBytes < 1024 * 1024
                      ? `${(totalStorageBytes / 1024).toFixed(1)} KB`
                      : `${(totalStorageBytes / (1024 * 1024)).toFixed(1)} MB`} / 100 MB
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-sidebar-accent overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500",
                      totalStorageBytes >= STORAGE_LIMIT_BYTES * 0.9 ? "bg-destructive" :
                      totalStorageBytes >= STORAGE_LIMIT_BYTES * 0.7 ? "bg-amber-500" :
                      "bg-primary")}
                    style={{ width: `${Math.min(100, (totalStorageBytes / STORAGE_LIMIT_BYTES) * 100)}%` }}
                  />
                </div>
                {totalStorageBytes >= STORAGE_LIMIT_BYTES * 0.9 && (
                  <p className="text-[9px] text-destructive mt-1">
                    {totalStorageBytes >= STORAGE_LIMIT_BYTES ? 'Limit reached — delete notes to create new ones.' : 'Almost full.'}
                  </p>
                )}
              </div>
            )}

            {/* Vault */}
            <div>
              <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1.5 font-semibold">Vault</p>
              <div className="rounded-lg border border-sidebar-border/60 overflow-hidden">
                {vaultHandle ? (
                  <>
                    <button onClick={() => userId && openNewVault(userId)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors">
                      <FolderOpen size={11} className="text-primary/60" /> Change folder
                    </button>
                    <div className="h-px bg-sidebar-border/40 mx-2" />
                    <button onClick={() => userId && disconnectVault(userId)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-destructive/70 hover:bg-destructive/8 transition-colors">
                      <FolderX size={11} /> Disconnect
                    </button>
                  </>
                ) : (
                  <button onClick={() => userId && openNewVault(userId)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors">
                    <FolderOpen size={11} className="text-primary/60" /> Open vault
                  </button>
                )}
              </div>
            </div>

            {/* Encryption */}
            {vaultHandle && (
              <div>
                <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1.5 font-semibold">Encryption</p>
                <div className="rounded-lg border border-sidebar-border/60 overflow-hidden">
                  {/* Status row */}
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    {isVaultEncrypted ? (
                      <>
                        <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                          <ShieldCheck size={10} className="text-green-500" />
                        </div>
                        <span className="text-[11px] text-sidebar-foreground/70 flex-1">
                          {encryptionKey ? 'Unlocked' : 'Locked'}
                        </span>
                        {encryptionKey && (
                          <button onClick={lockVault}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sidebar-accent text-[9px] font-medium text-sidebar-foreground/60 hover:text-foreground transition-colors">
                            <Lock size={8} /> Lock
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="w-5 h-5 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                          <LockOpen size={10} className="text-sidebar-foreground/40" />
                        </div>
                        <span className="text-[11px] text-sidebar-foreground/50 flex-1">Not encrypted</span>
                      </>
                    )}
                  </div>

                  {(encryptionKey || !isVaultEncrypted) && <div className="h-px bg-sidebar-border/40 mx-2" />}
                  {encryptionKey && (
                    <button onClick={() => { setShowEncryption(p => !p); setEncPwd(''); setEncPwd2(''); setEncError(''); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-destructive/70 hover:bg-destructive/8 transition-colors">
                      <LockOpen size={11} /> Disable encryption
                    </button>
                  )}
                  {!isVaultEncrypted && (
                    <button onClick={() => { setShowEncryption(p => !p); setEncPwd(''); setEncPwd2(''); setEncError(''); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors">
                      <Lock size={11} className="text-primary/60" /> Enable encryption
                    </button>
                  )}

                  {/* Password form */}
                  {showEncryption && (
                    <div className="mx-2 mb-2 mt-1 space-y-1.5 bg-sidebar-accent/40 rounded-md px-2.5 py-2.5">
                      {!isVaultEncrypted && (
                        <>
                          <p className="text-[10px] text-sidebar-foreground/50 leading-snug">
                            AES-256-GCM encryption. Choose a strong password — it cannot be recovered.
                          </p>
                          <input type="password" value={encPwd} onChange={e => setEncPwd(e.target.value)}
                            placeholder="New password"
                            className="w-full px-2 py-1.5 rounded-md border border-border/60 bg-background text-[11px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40" />
                          <input type="password" value={encPwd2} onChange={e => setEncPwd2(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full px-2 py-1.5 rounded-md border border-border/60 bg-background text-[11px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40" />
                        </>
                      )}
                      {isVaultEncrypted && encryptionKey && (
                        <p className="text-[10px] text-sidebar-foreground/50 leading-snug">
                          All notes will be decrypted and the key file removed.
                        </p>
                      )}
                      {encError && <p className="text-[10px] text-destructive">{encError}</p>}
                      <div className="flex gap-1.5 pt-0.5">
                        <button
                          disabled={encLoading}
                          onClick={async () => {
                            setEncError('');
                            if (!isVaultEncrypted) {
                              if (!encPwd) { setEncError('Enter a password.'); return; }
                              if (encPwd !== encPwd2) { setEncError('Passwords do not match.'); return; }
                              if (encPwd.length < 8) { setEncError('Use at least 8 characters.'); return; }
                              setEncLoading(true);
                              await enableEncryption(encPwd);
                              setEncLoading(false);
                            } else {
                              setEncLoading(true);
                              await disableEncryption();
                              setEncLoading(false);
                            }
                            setShowEncryption(false);
                            setEncPwd(''); setEncPwd2('');
                          }}
                          className="flex-1 py-1.5 rounded-md text-[10px] font-semibold bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors">
                          {encLoading ? '…' : isVaultEncrypted ? 'Decrypt & disable' : 'Encrypt vault'}
                        </button>
                        <button onClick={() => { setShowEncryption(false); setEncPwd(''); setEncPwd2(''); setEncError(''); }}
                          className="px-2.5 py-1.5 rounded-md text-[10px] text-sidebar-foreground/50 hover:bg-sidebar-accent transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Install PWA */}
            {!isInstalled && canInstall && (
              <button onClick={install}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-semibold border border-primary/20">
                <Download size={12} /> Install Ballpoint
              </button>
            )}
            {isInstalled && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-green-500/8 border border-green-500/20 text-[10px] text-green-600 dark:text-green-400">
                <CheckCircle2 size={11} /> Installed as desktop app
              </div>
            )}

          </div>
        </div>
      )}

      {/* New note + search */}
      {vaultHandle && (
        <div className="px-2 py-2 border-b border-sidebar-border flex gap-1">
          <button onClick={() => { createNewNote(); onMobileClose?.(); }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 md:py-1 rounded-md bg-primary text-primary-foreground text-[13px] md:text-[11px] font-medium hover:opacity-90 active:opacity-80 transition-opacity">
            <Plus size={13} className="md:w-[11px] md:h-[11px]" /> New Note
          </button>
          <button onClick={onOpenCommandPalette} title="Search (⌘K)"
            className="w-9 md:w-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Search size={14} className="md:w-[11px] md:h-[11px]" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-1 px-1.5 space-y-px">
        {/* Notes section */}
        <p className="px-1.5 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">Notes</p>
        {noteItems.map(item => {
          const active = isSectionActive(item.id);
          return (
            <button key={item.id.type}
              onClick={() => { setActiveSection(item.id); onMobileClose?.(); }}
              onContextMenu={e => openCtx(e, item.ctx)}
              className={cn("w-full flex items-center gap-1.5 px-2 py-2.5 md:py-1 rounded-md text-[13px] md:text-[12px] transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/50")}>
              <span className={active ? "text-primary" : "text-sidebar-foreground/35"}>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.count > 0 && (
                <span className={cn("text-[10px] tabular-nums", active ? "text-primary font-semibold" : "text-sidebar-foreground/30")}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}

        {/* Tasks section */}
        <p className="px-1.5 pt-3 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">Tasks</p>
        {taskItems.map(item => {
          const active = isSectionActive(item.id);
          return (
            <button key={item.id.type}
              onClick={() => { setActiveSection(item.id); onMobileClose?.(); }}
              onContextMenu={e => openCtx(e, item.ctx)}
              className={cn("w-full flex items-center gap-1.5 px-2 py-2.5 md:py-1 rounded-md text-[13px] md:text-[12px] transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/50")}>
              <span className={active ? "text-primary" : "text-sidebar-foreground/35"}>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.count > 0 && (
                <span className={cn("text-[10px] tabular-nums", active ? "text-primary font-semibold" : "text-sidebar-foreground/30")}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="pt-1.5">
            <button onClick={() => setTagsOpen(p => !p)}
              className="w-full flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-widest font-semibold text-sidebar-foreground/30 hover:text-sidebar-foreground/55 transition-colors">
              {tagsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />} Tags
            </button>
            {tagsOpen && (
              <div className="mt-0.5 space-y-px">
                {tags.map(tag => {
                  const tagSection: SidebarSection = { type: 'tag', tag };
                  const active = activeSection.type === 'tag' && (activeSection as any).tag === tag;
                  const count = notes.filter(n => n.status === 'active' && n.tags.includes(tag)).length;
                  const tagCtx: CtxItem[] = [
                    { label: `Filter by #${tag}`, icon: <TagIcon size={12} />, action: () => setActiveSection(tagSection) },
                    { label: 'Delete Tag', icon: <Trash size={12} />, danger: true, action: () => {
                      if (confirm(`Remove tag "#${tag}" from all notes?`))
                        notes.filter(n => n.tags.includes(tag)).forEach(n =>
                          setTags(n.id, n.tags.filter(t => t !== tag))
                        );
                    }},
                  ];
                  return (
                    <button key={tag}
                      onClick={() => { setActiveSection(tagSection); onMobileClose?.(); }}
                      onContextMenu={e => openCtx(e, tagCtx)}
                      className={cn("w-full flex items-center gap-1.5 pl-3.5 pr-2 py-2 md:py-1 rounded-md text-[12px] md:text-[11px] transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50")}>
                      <Tag size={10} className={active ? "text-primary" : "text-sidebar-foreground/30"} />
                      <span className="flex-1 text-left truncate">{tag}</span>
                      {count > 0 && <span className={cn("text-[10px] tabular-nums", active ? "text-primary" : "text-sidebar-foreground/30")}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Install app pill — shown at bottom when not in settings */}
      {!settingsOpen && !isInstalled && canInstall && (
        <div className="px-2 pb-2 pt-1 border-t border-sidebar-border">
          <button onClick={install}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-medium">
            <Download size={11} /> Install Ballpoint
          </button>
        </div>
      )}
    </aside>

    {/* ── Context menu overlay ─────────────────────────────────────── */}
    {ctxMenu && (
      <div
        ref={ctxRef}
        style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
        className="min-w-[160px] bg-popover border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
      >
        {ctxMenu.items.map((item, i) => (
          <button
            key={i}
            onClick={() => runCtx(item.action)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors text-left",
              item.danger
                ? "text-destructive hover:bg-destructive/10"
                : "text-popover-foreground hover:bg-muted"
            )}
          >
            <span className="opacity-60">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    )}

    {/* Cloud Sync panel modal */}
    {syncPanelOpen && <SettingsPanel onClose={() => setSyncPanelOpen(false)} />}
    </>
  );
}
