import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Mail, LogIn, AlertCircle, Menu, ArrowLeft, X, Loader2, FolderOpen, XCircle } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { getApiUrl } from '../lib/apiUrl';
import { WelcomeScreen } from '../components/WelcomeScreen';
import { Sidebar } from '../components/Sidebar';
import { NoteList } from '../components/NoteList';
import { Editor } from '../components/Editor';
import { TaskWorkspace } from '../components/TaskWorkspace';
import { CommandPalette } from '../components/CommandPalette';
import { cn } from '../lib/utils';

const API = getApiUrl();

const LOCAL_USER_ID = 0;

// ─── Vault Lock Screen ────────────────────────────────────────────────────────
function VaultLockScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const unlockVault   = useNotesStore(s => s.unlockVault);
  const unlockWithPin = useNotesStore(s => s.unlockWithPin);
  const hasPin        = useNotesStore(s => s.hasPin);
  const userId        = useNotesStore(s => s.userId);
  const r2Mode        = useNotesStore(s => s.r2Mode);

  // ── Re-auth state (needed when cloud vault token is missing after update) ──
  const [showReAuth,  setShowReAuth]  = useState(false);
  const [reauthEmail, setReauthEmail] = useState('');
  const [reauthPwd,   setReauthPwd]   = useState('');
  const [reauthErr,   setReauthErr]   = useState('');
  const [reauthLoad,  setReauthLoad]  = useState(false);

  const [usePinMode, setUsePinMode]   = useState(userId !== null ? hasPin() : false);
  const [password, setPassword]       = useState('');
  const [pin, setPin]                 = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);

  // Detect missing R2 token on first mount
  const needsReAuth = r2Mode && (() => {
    try {
      const tok = localStorage.getItem('ballpoint-r2-token');
      return !tok;
    } catch { return true; }
  })();

  const handleReAuth = async () => {
    setReauthErr('');
    if (!reauthEmail.trim() || !reauthPwd) { setReauthErr('Enter email and password.'); return; }
    setReauthLoad(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reauthEmail.trim(), password: reauthPwd }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { error: text }; }
      if (!res.ok) throw new Error(data?.error ?? data?.message ?? 'Auth failed');

      // Persist the fresh token
      try { localStorage.setItem('ballpoint-r2-token', data.token); } catch {}
      // Close re-auth and try password flow normally
      setShowReAuth(false);
      setReauthEmail('');
      setReauthPwd('');
      setError('');
    } catch (e: any) {
      setReauthErr(e.message ?? 'Login failed.');
    } finally {
      setReauthLoad(false);
    }
  };

  const handleUnlock = async () => {
    setLoading(true);
    setError('');
    if (usePinMode) {
      if (!pin) { setError('Enter your PIN.'); setLoading(false); return; }
      const ok = await unlockWithPin(pin);
      if (!ok) {
        setError('Wrong PIN — try again.');
        setPin('');
      }
    } else {
      if (!password) { setError('Enter your password.'); setLoading(false); return; }
      const ok = await unlockVault(password);
      if (!ok) {
        // Check if the failure was due to missing token, not wrong password
        const hasToken = (() => { try { return !!localStorage.getItem('ballpoint-r2-token'); } catch { return false; } })();
        if (r2Mode && !hasToken) {
          setShowReAuth(true);
          setError('Session expired. Log in again to refresh your cloud vault token.');
        } else {
          setError('Wrong password — try again.');
        }
        setPassword('');
      }
    }
    setLoading(false);
  };

  const switchMode = () => {
    setUsePinMode(p => !p);
    setError('');
    setPassword('');
    setPin('');
  };

  // ── Re-auth screen ──────────────────────────────────────────────────────────
  if (showReAuth) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <div className="md:hidden flex items-center h-12 px-4 border-b border-border shrink-0">
          <button onClick={onOpenSidebar} className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors">
            <Menu size={20} />
          </button>
          <span className="ml-2 text-sm font-semibold text-foreground">Ballpoint</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-xs p-6 rounded-2xl border border-border bg-card shadow-2xl space-y-4">
            <div className="flex flex-col items-center gap-2 pb-1">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <LogIn size={22} className="text-primary" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Re-authenticate</h2>
              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                Your vault session expired. Log in to refresh your cloud vault token.
              </p>
            </div>
            <input
              type="email"
              value={reauthEmail}
              onChange={e => setReauthEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              autoFocus
              className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
            <input
              type="password"
              value={reauthPwd}
              onChange={e => setReauthPwd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReAuth()}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
            {reauthErr && <p className="text-[11px] text-destructive text-center">{reauthErr}</p>}
            <button
              onClick={handleReAuth}
              disabled={!reauthEmail.trim() || !reauthPwd || reauthLoad}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {reauthLoad ? <><Loader2 size={14} className="animate-spin inline mr-1" /> Logging in…</> : 'Log In'}
            </button>
            <button
              onClick={() => { setShowReAuth(false); setReauthErr(''); }}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              {needsReAuth
                ? 'Session expired — log in below.'
                : usePinMode
                  ? 'Enter your PIN to quickly unlock.'
                  : 'This vault is encrypted. Enter your password to unlock.'}
            </p>
          </div>
          {needsReAuth ? (
            <>
              <input
                type="email"
                value={reauthEmail}
                onChange={e => setReauthEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                autoFocus
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              />
              <input
                type="password"
                value={reauthPwd}
                onChange={e => setReauthPwd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleReAuth()}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              />
              {reauthErr && <p className="text-[11px] text-destructive text-center">{reauthErr}</p>}
              <button
                onClick={handleReAuth}
                disabled={!reauthEmail.trim() || !reauthPwd || reauthLoad}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {reauthLoad ? <><Loader2 size={14} className="animate-spin inline mr-1" /> Logging in…</> : 'Log In'}
              </button>
            </>
          ) : (
            <>
              {usePinMode ? (
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                  placeholder="Enter PIN"
                  autoFocus
                  maxLength={10}
                  className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40 text-center tracking-[0.3em]"
                />
              ) : (
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                  placeholder="Encryption password"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                />
              )}
              {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
              <button
                onClick={handleUnlock}
                disabled={(usePinMode ? !pin : !password) || loading}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {loading ? 'Unlocking…' : 'Unlock Vault'}
              </button>
              {usePinMode ? (
                <button onClick={switchMode}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
                  Use password instead
                </button>
              ) : userId !== null && hasPin() && (
                <button onClick={switchMode}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
                  Use PIN instead
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // Only subscribe to primitives that this component actually needs
  const vaultHandle       = useNotesStore(s => s.vaultHandle);
  const proxyVault        = useNotesStore(s => s.proxyVault);
  const isLoading         = useNotesStore(s => s.isLoading);
  const isVaultEncrypted  = useNotesStore(s => s.isVaultEncrypted);
  const encryptionKey     = useNotesStore(s => s.encryptionKey);
  const r2Mode            = useNotesStore(s => s.r2Mode);
  const activeNoteId      = useNotesStore(s => s.activeNoteId);
  const activeSection     = useNotesStore(s => s.activeSection);
  const init              = useNotesStore(s => s.init);
  const reset             = useNotesStore(s => s.reset);

  const isTaskView = activeSection.type.startsWith('tasks-');

  const [cmdOpen,      setCmdOpen]      = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [mobileView,   setMobileView]   = useState<'list' | 'editor'>('list');

  // When a note is selected from the sidebar/command palette (not from NoteList tap),
  // also switch to editor. NoteList taps call onNoteOpen directly.
  const prevNoteId = useRef(activeNoteId);
  useEffect(() => {
    if (!isTaskView && activeNoteId && activeNoteId !== prevNoteId.current) {
      setMobileView('editor');
    }
    prevNoteId.current = activeNoteId;
  }, [activeNoteId, isTaskView]);

  const handleNoteOpen = useCallback(() => setMobileView('editor'), []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    init(LOCAL_USER_ID);
    return () => reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut — use a ref so the handler never needs to be re-registered
  const vaultRef = useRef(vaultHandle);
  const taskViewRef = useRef(isTaskView);
  useEffect(() => { vaultRef.current = vaultHandle; }, [vaultHandle]);
  useEffect(() => { taskViewRef.current = isTaskView; }, [isTaskView]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (!vaultRef.current) return;
        if (taskViewRef.current) {
          useNotesStore.getState().createTaskNote();
        } else {
          useNotesStore.getState().createNewNote();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable — reads vault and taskView from ref

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

  // ── Cache restore banner ────────────────────────────────────────
  // Shown when vault handle permission was lost and notes were restored from cache
  const isFromCache = proxyVault === '__vault_cache__';

  // R2 cloud vault on reload: show unlock screen instead of WelcomeScreen
  if ((!vaultHandle && proxyVault === null) && !r2Mode) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden relative">
        {sidebarDrawer}
        <WelcomeScreen onOpenSidebar={() => setSidebarOpen(true)} />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  // Vault is open but locked — show password/PIN prompt
  // R2 cloud vaults always have isVaultEncrypted=true once opened
  if (isVaultEncrypted && !encryptionKey) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden text-foreground relative">
        {sidebarDrawer}
        <VaultLockScreen onOpenSidebar={() => setSidebarOpen(true)} />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  // ── Cache restore banner ────────────────────────────────────────
  const cacheBanner = isFromCache ? (
    <div className="sticky top-0 z-50 flex items-center gap-2 bg-amber-500/15 border-b border-amber-500/25 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">
        Folder access restored from cache —{' '}
        <button
          onClick={async () => {
            const { reconnectVault, userId } = useNotesStore.getState();
            if (userId !== null) await reconnectVault(userId);
          }}
          className="underline font-semibold hover:no-underline"
        >
          re-select folder
        </button>
        {' '}to regain full access
      </span>
      <button
        onClick={() => useNotesStore.setState({ proxyVault: null })}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        title="Dismiss"
      >
        <XCircle size={14} />
      </button>
    </div>
  ) : null;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground relative">
      {cacheBanner}
      {sidebarDrawer}

      {isTaskView ? (
        <TaskWorkspace onOpenSidebar={() => setSidebarOpen(true)} />
      ) : (
        <>
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
        </>
      )}

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}