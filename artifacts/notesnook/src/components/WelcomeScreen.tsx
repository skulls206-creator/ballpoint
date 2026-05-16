import { useState } from 'react';
import {
  FolderOpen, HardDrive, Lock, Menu, AlertCircle, Loader2,
  ExternalLink, Cloud, KeyRound, Eye, EyeOff, ChevronLeft,
  User, Mail, LogIn, UserPlus,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { isFileSystemSupported } from '../lib/fileSystem';
import { getApiUrl } from '../lib/apiUrl';

const API = getApiUrl();

function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}
function openInNewTab() {
  window.open(window.location.href, '_blank', 'noopener,noreferrer');
}

function MobileTopBar({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  return (
    <div className="md:hidden flex items-center h-12 px-4 border-b border-border shrink-0">
      <button
        onClick={onOpenSidebar}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
      >
        <Menu size={20} />
      </button>
      <span className="ml-2 text-sm font-semibold text-foreground">Ballpoint</span>
    </div>
  );
}

type VaultMode = 'local' | 'cloud' | null;
type AuthMode = 'login' | 'register';

export function WelcomeScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const openNewVault   = useNotesStore(s => s.openNewVault);
  const openR2Vault    = useNotesStore(s => s.openR2Vault);
  const createR2Vault  = useNotesStore(s => s.createR2Vault);

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [isSecurityError, setIsSecurityError] = useState(false);

  // Cloud vault form state
  const [mode, setMode]             = useState<VaultMode>(isFileSystemSupported ? null : 'cloud');

  // Auth state
  const [authMode, setAuthMode]     = useState<AuthMode>('login');
  const [authEmail, setAuthEmail]   = useState('');
  const [authPwd, setAuthPwd]       = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [jwtToken, setJwtToken]     = useState('');
  const [authDone, setAuthDone]     = useState(false);

  // Vault connect state
  const [vaultPwd, setVaultPwd]     = useState('');
  const [vaultShowPwd, setVaultShowPwd] = useState(false);
  const [vaultCreate, setVaultCreate] = useState(false);

  const inIframe = isInIframe();
  const showCloudForm = mode === 'cloud';

  // ── Local folder picker ────────────────────────────────────────────────────

  const handleOpen = async () => {
    setError(null);
    setIsSecurityError(false);
    setLoading(true);
    try {
      await openNewVault(0);
    } catch (e: any) {
      if (e?.name === 'SecurityError') {
        setIsSecurityError(true);
        setError("Browser blocked the folder picker — the app is embedded in an iframe without file-system permission.");
      } else {
        setError(e?.message ?? 'Something went wrong opening the folder.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Auth (login / register) ────────────────────────────────────────────────

  const handleAuth = async () => {
    setError(null);
    if (!authEmail.trim()) { setError('Enter your email.'); return; }
    if (!authPwd || authPwd.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim(), password: authPwd }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { error: text }; }
      if (!res.ok) {
        const msg = data?.error ?? data?.message ?? text ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setJwtToken(data.token);
      setAuthDone(true);
    } catch (e: any) {
      setError(e.message ?? 'Authentication failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Cloud vault connect ────────────────────────────────────────────────────

  const handleConnectCloud = async () => {
    setError(null);
    if (!jwtToken) { setError('Log in or register first.'); return; }
    if (!vaultPwd) { setError('Enter a vault password.'); return; }
    setLoading(true);
    try {
      if (vaultCreate) {
        await createR2Vault(0, jwtToken, vaultPwd);
      } else {
        await openR2Vault(0, jwtToken, vaultPwd);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect to cloud vault.');
    } finally {
      setLoading(false);
    }
  };

  const resetAuth = () => {
    setJwtToken('');
    setAuthDone(false);
    setAuthEmail('');
    setAuthPwd('');
    setError(null);
  };

  // ── In iframe: KHURK proxy mode ────────────────────────────────────────────

  if (inIframe) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <MobileTopBar onOpenSidebar={onOpenSidebar} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="max-w-sm w-full text-center space-y-6">
            <div className="inline-flex items-center justify-center">
              <img src="/images/icon-192.png" alt="Ballpoint" className="w-16 h-16 rounded-2xl shadow-md" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                Local<span className="text-primary"> Notes</span>
              </h1>
            </div>
            <div className="space-y-3">
              <button
                onClick={openInNewTab}
                className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20"
              >
                <ExternalLink size={15} /> Open in Browser Tab
              </button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Browsers block the folder picker inside iframes. Opening in its own tab gives Ballpoint full file-system access.
              </p>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 px-4 py-3 rounded-lg">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                  </span>
                  <p className="text-[12.5px] font-medium text-foreground">
                    Listening for KHURK OS to share a folder…
                  </p>
                </div>
                <div className="bg-muted/40 border border-border/60 rounded-lg px-3 py-2.5 text-left space-y-1.5">
                  <p className="text-[10.5px] font-semibold text-foreground/70 uppercase tracking-wide">Hollr must send:</p>
                  <pre className="text-[10px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all font-mono">{`iframe.contentWindow.postMessage({
  type: 'khurk:vault-open',
  name: dir.name,
  files: [{ name, content, lastModified }]
}, '*')`}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Unsupported browser → default to cloud ─────────────────────────────────

  if (!isFileSystemSupported && mode === null) {
    setMode('cloud');
  }

  // ── Mode selector tabs ─────────────────────────────────────────────────────

  const ModeSelector = () => (
    <div className="flex gap-2 mb-4">
      <button
        onClick={() => { setMode('local'); setError(null); }}
        className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
          mode === 'local'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        <FolderOpen size={13} /> Local Folder
      </button>
      <button
        onClick={() => { setMode('cloud'); setError(null); resetAuth(); }}
        className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
          mode === 'cloud'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        <Cloud size={13} /> Cloud Vault
      </button>
    </div>
  );

  // ── Shared layout ──────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col bg-background">
      <MobileTopBar onOpenSidebar={onOpenSidebar} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center">
            <img src="/images/icon-192.png" alt="Ballpoint" className="w-16 h-16 rounded-2xl shadow-md" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              <span className="text-primary">Ballpoint</span>
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {showCloudForm
                ? 'Store your notes encrypted in a cloud bucket — accessible from any device.'
                : 'Select a folder on your computer to store your notes as plain Markdown files.'}
            </p>
          </div>

          {/* Mode tabs */}
          {isFileSystemSupported && <ModeSelector />}

          {/* ── Cloud Vault ──────────────────────────────────────────────────── */}
          {showCloudForm && (
            <div className="space-y-3 text-left">
              {!isFileSystemSupported && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-[11px] text-foreground font-medium">
                    Your browser doesn't support local folder access — use a cloud vault instead.
                  </p>
                </div>
              )}

              {/* Step 1: Auth — login or register */}
              {!authDone && (
                <div className="space-y-3 border border-border/60 rounded-lg p-4 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <User size={13} className="text-primary" />
                    <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide">
                      {authMode === 'login' ? 'Log In' : 'Create Account'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="email"
                      value={authEmail}
                      onChange={e => setAuthEmail(e.target.value)}
                      placeholder="Email"
                      autoComplete="email"
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                    <input
                      type="password"
                      value={authPwd}
                      onChange={e => setAuthPwd(e.target.value)}
                      placeholder="Password (min 6 chars)"
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                  </div>

                  <button
                    onClick={handleAuth}
                    disabled={authLoading || !authEmail.trim() || authPwd.length < 6}
                    className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {authLoading
                      ? <><Loader2 size={12} className="animate-spin" /> Signing in…</>
                      : <>{authMode === 'login' ? <LogIn size={13} /> : <UserPlus size={13} />}
                         {authMode === 'login' ? 'Log In' : 'Register'}
                        </>
                    }
                  </button>

                  <button
                    onClick={() => { setAuthMode(m => m === 'login' ? 'register' : 'login'); setError(null); }}
                    className="w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                  >
                    {authMode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
                  </button>
                </div>
              )}

              {/* Step 2: Connected — show token status */}
              {authDone && (
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground">Authenticated</p>
                    <p className="text-[9px] text-muted-foreground truncate font-mono">{authEmail}</p>
                  </div>
                  <button
                    onClick={resetAuth}
                    className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                  >
                    Switch
                  </button>
                </div>
              )}

              {/* Step 3: Vault password + connect */}
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 block">
                  Vault Password
                </label>
                <div className="relative">
                  <input
                    type={vaultShowPwd ? 'text' : 'password'}
                    value={vaultPwd}
                    onChange={e => setVaultPwd(e.target.value)}
                    placeholder="Enter vault encryption password"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring pr-9 placeholder:text-muted-foreground/40"
                  />
                  <button
                    type="button"
                    onClick={() => setVaultShowPwd(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                  >
                    {vaultShowPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleConnectCloud}
                  disabled={loading || !jwtToken || !vaultPwd}
                  className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20 disabled:opacity-60"
                >
                  {loading
                    ? <><Loader2 size={13} className="animate-spin" /> Connecting…</>
                    : <><Cloud size={14} /> {vaultCreate ? 'Create Vault' : 'Connect Vault'}</>
                  }
                </button>

                <button
                  onClick={() => { setVaultCreate(c => !c); setError(null); }}
                  className="px-3 py-2 rounded-lg border border-border text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  {vaultCreate ? 'Existing' : 'New'}
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground/60 text-center">
                {vaultCreate
                  ? 'Create a new encrypted vault for this account.'
                  : 'Connect to an existing vault for this account.'}
              </p>

              {error && (
                <div className="flex items-start gap-2 bg-destructive/10 text-destructive p-3 rounded-lg border border-destructive/20 text-left">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Local Folder ────────────────────────────────────────────────── */}
          {mode === 'local' && (
            <div className="space-y-3">
              <button
                onClick={handleOpen}
                disabled={loading}
                className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20 disabled:opacity-60"
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Opening…</>
                  : <><FolderOpen size={15} /> Select Notes Folder</>
                }
              </button>

              {error && (
                <div className="flex flex-col gap-2.5 bg-destructive/10 text-destructive p-3 rounded-lg border border-destructive/20 text-left">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <p className="text-xs leading-relaxed">{error}</p>
                  </div>
                  {isSecurityError && (
                    <button
                      onClick={openInNewTab}
                      className="w-full h-8 rounded-md bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                    >
                      <ExternalLink size={12} /> Open in Browser Tab
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 pt-2">
                {[
                  { icon: <HardDrive size={13} />, label: '100% Local', desc: '.md files on disk' },
                  { icon: <Lock size={13} />,      label: 'Private',    desc: 'No cloud sync'    },
                  { icon: <FolderOpen size={13} />, label: 'Offline', desc: 'Works everywhere' },
                ].map(f => (
                  <div key={f.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/40 border border-border/40">
                    <span className="text-primary">{f.icon}</span>
                    <span className="text-[10px] font-semibold text-foreground/80">{f.label}</span>
                    <span className="text-[9px] text-muted-foreground">{f.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
