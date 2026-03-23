import { useState, useMemo } from 'react';
import {
  FileText, Star, Archive, Trash2, Tag, ChevronDown, ChevronRight,
  Plus, FolderOpen, FolderX, Sun, Moon, Settings, Zap, LogOut, Search,
  Download, CheckCircle2,
} from 'lucide-react';
import { useNotesStore, SidebarSection } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { AccentColor, getAllTags } from '../lib/metadata';
import { usePWAInstall } from '../lib/usePWAInstall';
import { cn } from '../lib/utils';

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

export function Sidebar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const { user, logout } = useAuth();
  const { canInstall, isInstalled, install } = usePWAInstall();

  const activeSection  = useNotesStore(s => s.activeSection);
  const vaultHandle    = useNotesStore(s => s.vaultHandle);
  const userId         = useNotesStore(s => s.userId);
  const theme          = useNotesStore(s => s.theme);
  const accentColor    = useNotesStore(s => s.accentColor);
  const notes          = useNotesStore(s => s.notes);
  const metadata       = useNotesStore(s => s.metadata);

  const setActiveSection = useNotesStore(s => s.setActiveSection);
  const createNewNote    = useNotesStore(s => s.createNewNote);
  const openNewVault     = useNotesStore(s => s.openNewVault);
  const disconnectVault  = useNotesStore(s => s.disconnectVault);
  const toggleTheme      = useNotesStore(s => s.toggleTheme);
  const setAccentColor   = useNotesStore(s => s.setAccentColor);

  const tags = useMemo(() => getAllTags(metadata, notes), [metadata, notes]);
  const counts = useMemo(() => ({
    all:       notes.filter(n => n.status === 'active').length,
    favorites: notes.filter(n => n.status === 'active' && n.isFavorite).length,
    archive:   notes.filter(n => n.status === 'archived').length,
    trash:     notes.filter(n => n.status === 'trashed').length,
  }), [notes]);

  const [tagsOpen,     setTagsOpen]     = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isSectionActive = (s: SidebarSection) => {
    if (s.type === 'tag' && activeSection.type === 'tag')
      return (activeSection as any).tag === (s as any).tag;
    return activeSection.type === s.type;
  };

  type NavItem = { id: SidebarSection; icon: React.ReactNode; label: string; count: number };
  const navItems: NavItem[] = [
    { id: { type: 'all' },       icon: <FileText size={13} />, label: 'Notes',     count: counts.all       },
    { id: { type: 'favorites' }, icon: <Star size={13} />,     label: 'Favorites', count: counts.favorites  },
    { id: { type: 'archive' },   icon: <Archive size={13} />,  label: 'Archive',   count: counts.archive    },
    { id: { type: 'trash' },     icon: <Trash2 size={13} />,   label: 'Trash',     count: counts.trash      },
  ];

  return (
    <aside className="w-[200px] shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border select-none overflow-hidden">
      {/* Branding */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-sidebar-border">
        <div className="w-5 h-5 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Zap size={10} className="text-primary" />
        </div>
        <span className="font-semibold text-[12px] text-sidebar-foreground tracking-tight">Ballpoint.one</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={toggleTheme} title="Toggle theme"
            className="w-5 h-5 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
          </button>
          <button onClick={() => setSettingsOpen(p => !p)} title="Settings"
            className={cn("w-5 h-5 rounded flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
              settingsOpen && "bg-sidebar-accent text-sidebar-foreground")}>
            <Settings size={11} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="px-3 py-2.5 border-b border-sidebar-border bg-sidebar space-y-3">
          {/* Accent colors */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1.5 font-semibold">Theme Color</p>
            <div className="grid grid-cols-5 gap-1.5">
              {ACCENT_COLORS.map(c => (
                <button key={c.id} onClick={() => setAccentColor(c.id)} title={c.label}
                  style={{ backgroundColor: `hsl(${c.hsl})` }}
                  className={cn(
                    "w-6 h-6 rounded-full transition-all flex items-center justify-center",
                    accentColor === c.id && "ring-2 ring-offset-2 ring-offset-sidebar ring-foreground/60"
                  )}>
                  {accentColor === c.id && <CheckCircle2 size={12} className="text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {/* Vault */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1 font-semibold">Vault</p>
            {vaultHandle ? (
              <div className="space-y-0.5">
                <button onClick={() => userId && openNewVault(userId)}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent transition-colors">
                  <FolderOpen size={10} /> Change folder
                </button>
                <button onClick={() => userId && disconnectVault(userId)}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-destructive/70 hover:bg-destructive/10 transition-colors">
                  <FolderX size={10} /> Disconnect
                </button>
              </div>
            ) : (
              <button onClick={() => userId && openNewVault(userId)}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent transition-colors">
                <FolderOpen size={10} /> Open vault
              </button>
            )}
          </div>

          {/* Install PWA */}
          {!isInstalled && canInstall && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1 font-semibold">App</p>
              <button onClick={install}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-medium">
                <Download size={11} /> Install App
              </button>
            </div>
          )}
          {isInstalled && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <CheckCircle2 size={10} className="text-green-500" /> Installed as desktop app
            </div>
          )}

          {/* Account */}
          {user && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-sidebar-foreground/35 mb-1 font-semibold">Account</p>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold uppercase shrink-0">
                  {user.email[0]}
                </div>
                <span className="text-[11px] text-sidebar-foreground/70 truncate flex-1">{user.email}</span>
              </div>
              <button onClick={logout}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-destructive/70 hover:bg-destructive/10 transition-colors">
                <LogOut size={10} /> Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {/* New note + search */}
      {vaultHandle && (
        <div className="px-2 py-2 border-b border-sidebar-border flex gap-1">
          <button onClick={() => createNewNote()}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 active:opacity-80 transition-opacity">
            <Plus size={11} /> New Note
          </button>
          <button onClick={onOpenCommandPalette} title="Search (⌘K)"
            className="w-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Search size={11} />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-1 px-1.5 space-y-px">
        {navItems.map(item => {
          const active = isSectionActive(item.id);
          return (
            <button key={item.id.type} onClick={() => setActiveSection(item.id)}
              className={cn("w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] transition-colors",
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
                  return (
                    <button key={tag} onClick={() => setActiveSection(tagSection)}
                      className={cn("w-full flex items-center gap-1.5 pl-3.5 pr-2 py-1 rounded-md text-[11px] transition-colors",
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
            <Download size={11} /> Install Ballpoint.one
          </button>
        </div>
      )}
    </aside>
  );
}
