import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Menu } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { WelcomeScreen } from '../components/WelcomeScreen';
import { Sidebar } from '../components/Sidebar';
import { NoteList } from '../components/NoteList';
import { Editor } from '../components/Editor';
import { CommandPalette } from '../components/CommandPalette';
import { cn } from '../lib/utils';

// ─── Vault Lock Screen ────────────────────────────────────────────────────────
function VaultLockScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const unlockVault = useNotesStore(s => s.unlockVault);
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleUnlock = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    const ok = await unlockVault(password);
    if (!ok) {
      setError('Wrong password — try again.');
      setPassword('');
    }
    setLoading(false);
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center h-12 px-4 border-b border-border shrink-0">
        <button
          onClick={onOpenSidebar}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        >
          <Menu size={20} />
        </button>
        <span className="ml-2 text-sm font-semibold text-foreground">Ballpoint</span>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-xs p-6 rounded-2xl border border-border bg-card shadow-2xl space-y-4">
          <div className="flex flex-col items-center gap-2 pb-1">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock size={22} className="text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Vault Locked</h2>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              This vault is encrypted. Enter your password to unlock.
            </p>
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            placeholder="Encryption password"
            autoFocus
            className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          />
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <button
            onClick={handleUnlock}
            disabled={!password || loading}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {loading ? 'Unlocking…' : 'Unlock Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();

  // Only subscribe to primitives that this component actually needs
  const vaultHandle       = useNotesStore(s => s.vaultHandle);
  const isLoading         = useNotesStore(s => s.isLoading);
  const isVaultEncrypted  = useNotesStore(s => s.isVaultEncrypted);
  const encryptionKey     = useNotesStore(s => s.encryptionKey);
  const activeNoteId      = useNotesStore(s => s.activeNoteId);
  const init              = useNotesStore(s => s.init);
  const reset             = useNotesStore(s => s.reset);

  const [cmdOpen,      setCmdOpen]      = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [mobileView,   setMobileView]   = useState<'list' | 'editor'>('list');

  // When a note is selected from the sidebar/command palette (not from NoteList tap),
  // also switch to editor. NoteList taps call onNoteOpen directly.
  const prevNoteId = useRef(activeNoteId);
  useEffect(() => {
    if (activeNoteId && activeNoteId !== prevNoteId.current) {
      setMobileView('editor');
    }
    prevNoteId.current = activeNoteId;
  }, [activeNoteId]);

  const handleNoteOpen = useCallback(() => setMobileView('editor'), []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (user) {
      init(user.id);
    } else {
      reset();
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut — use a ref so the handler never needs to be re-registered
  const vaultRef = useRef(vaultHandle);
  useEffect(() => { vaultRef.current = vaultHandle; }, [vaultHandle]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (vaultRef.current) useNotesStore.getState().createNewNote();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable — reads vault from ref

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="mt-3 text-xs text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  // ── Shared sidebar drawer (used in all non-loading layouts) ──────────────────
  const sidebarDrawer = (
    <>
      {/* Backdrop — mobile only, closes sidebar on tap */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300',
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={closeSidebar}
      />
      {/* Sidebar column — drawer on mobile, static on desktop */}
      <div
        className={cn(
          'fixed md:relative inset-y-0 left-0 z-50 h-full',
          'transition-transform duration-300 ease-in-out',
          'md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar
          onOpenCommandPalette={() => setCmdOpen(true)}
          onMobileClose={closeSidebar}
        />
      </div>
    </>
  );

  if (!vaultHandle) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden relative">
        {sidebarDrawer}
        <WelcomeScreen onOpenSidebar={() => setSidebarOpen(true)} />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  // Vault is open but locked — show password prompt
  if (isVaultEncrypted && !encryptionKey) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden text-foreground relative">
        {sidebarDrawer}
        <VaultLockScreen onOpenSidebar={() => setSidebarOpen(true)} />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground relative">
      {sidebarDrawer}

      {/* NoteList — full-width on mobile (list view), fixed column on desktop */}
      <div className={cn(
        'h-full md:flex md:flex-none',
        mobileView === 'list' ? 'flex flex-1' : 'hidden',
      )}>
        <NoteList onOpenSidebar={() => setSidebarOpen(true)} onNoteOpen={handleNoteOpen} />
      </div>

      {/* Editor — full-width on mobile (editor view), flex-1 on desktop */}
      <div className={cn(
        'h-full flex-1 min-w-0 md:flex',
        mobileView === 'editor' ? 'flex' : 'hidden',
      )}>
        <Editor onBack={() => setMobileView('list')} />
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
