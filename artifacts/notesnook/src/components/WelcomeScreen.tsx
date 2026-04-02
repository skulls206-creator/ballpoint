import { useState, useEffect } from 'react';
import {
  FolderOpen, HardDrive, Shield, Lock, Menu, AlertCircle, Loader2,
  ExternalLink, WifiOff, Cloud, CloudOff, KeyRound, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { isFileSystemSupported } from '../lib/fileSystem';

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

export function WelcomeScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const { user, token } = useAuth();

  const openNewVault   = useNotesStore(s => s.openNewVault);
  const r2Mode         = useNotesStore(s => s.r2Mode);
  const r2Configured   = useNotesStore(s => s.r2Configured);
  const r2Status       = useNotesStore(s => s.r2Status);
  const r2Error        = useNotesStore(s => s.r2Error);
  const openR2Vault    = useNotesStore(s => s.openR2Vault);
  const createR2Vault  = useNotesStore(s => s.createR2Vault);
  const checkR2Status  = useNotesStore(s => s.checkR2Status);

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [isSecurityError, setIsSecurityError] = useState(false);
  const [cloudStep, setCloudStep] = useState<'choose' | 'open' | 'create'>('choose');
  const [password, setPassword]   = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]       = useState(false);
  /** On desktop (FS supported), user can opt into pure cloud-vault mode */
  const [desktopCloudMode, setDesktopCloudMode] = useState(false);

  const inIframe = isInIframe();

  useEffect(() => {
    checkR2Status();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local folder picker ────────────────────────────────────────────────────

  const handleOpen = async () => {
    if (!user) return;
    setError(null);
    setIsSecurityError(false);
    setLoading(true);
    try {
      await openNewVault(user.id);
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

  // ── R2 cloud vault handlers ────────────────────────────────────────────────

  const handleOpenR2 = async () => {
    if (!user || !token || !password) return;
    setLoading(true);
    setError(null);
    try {
      await openR2Vault(user.id, token, password);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to open cloud vault');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateR2 = async () => {
    if (!user || !token || !password) return;
    if (password !== confirmPw) { setError('Passwords do not match'); return; }
    if (password.length < 8)    { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    setError(null);
    try {
      await createR2Vault(user.id, token, password);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create cloud vault');
    } finally {
      setLoading(false);
    }
  };

  // ── R2 returning user: just unlock ────────────────────────────────────────

  if (r2Mode) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <MobileTopBar onOpenSidebar={onOpenSidebar} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-xs p-6 rounded-2xl border border-border bg-card shadow-2xl space-y-4">
            <div className="flex flex-col items-center gap-2 pb-1">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Cloud size={22} className="text-primary" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Cloud Vault</h2>
              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                {r2Configured
                  ? 'Enter your vault password to unlock your cloud notes.'
                  : 'Cloud storage is not configured on the server.'}
              </p>
              {user && (
                <p className="text-[10px] text-muted-foreground/50">
                  {user.email}
                </p>
              )}
            </div>

            {r2Configured ? (
              <>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOpenR2()}
                    placeholder="Vault password"
                    autoFocus
                    className="w-full px-3 py-2.5 pr-9 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {(error ?? r2Error) && (
                  <p className="text-[11px] text-destructive">{error ?? r2Error}</p>
                )}

                <button
                  onClick={handleOpenR2}
                  disabled={!password || loading || r2Status === 'syncing'}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  {(loading || r2Status === 'syncing')
                    ? <><Loader2 size={14} className="animate-spin" /> Opening…</>
                    : <><Cloud size={14} /> Open Cloud Vault</>
                  }
                </button>
              </>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                <CloudOff size={14} className="shrink-0 mt-0.5" />
                <p className="text-[11px]">R2 cloud storage is not configured on the server. Contact your administrator.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── iOS / no File System API: R2 cloud setup ──────────────────────────────

  if (!isFileSystemSupported) {
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
                Ballpoint <span className="text-primary">Cloud</span>
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your notes, encrypted and synced via cloud storage. Works on all devices.
              </p>
              {user && (
                <p className="text-xs text-muted-foreground/60">
                  Signed in as <span className="font-medium text-foreground/70">{user.email}</span>
                </p>
              )}
            </div>

            {!r2Configured ? (
              /* R2 not configured on server */
              <div className="bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20 text-left">
                <h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
                  <CloudOff size={14} /> Cloud storage not available
                </h3>
                <p className="text-xs opacity-80">
                  R2 cloud storage is not configured on this server. Please contact the administrator to set up the R2 bucket.
                </p>
              </div>
            ) : cloudStep === 'choose' ? (
              /* Choose: open existing or create new */
              <div className="space-y-3">
                <button
                  onClick={() => { setCloudStep('open'); setError(null); setPassword(''); }}
                  className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20"
                >
                  <Cloud size={15} /> Open Existing Cloud Vault
                </button>
                <button
                  onClick={() => { setCloudStep('create'); setError(null); setPassword(''); setConfirmPw(''); }}
                  className="w-full h-10 rounded-lg bg-muted text-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted/80 active:opacity-80 transition-opacity border border-border"
                >
                  <KeyRound size={15} /> Create New Cloud Vault
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Notes are AES-256-GCM encrypted before leaving your device.
                </p>
              </div>
            ) : cloudStep === 'open' ? (
              /* Open existing vault: enter password */
              <div className="space-y-3 text-left">
                <button
                  onClick={() => setCloudStep('choose')}
                  className="text-[11px] text-primary flex items-center gap-1 hover:opacity-80"
                >
                  ← Back
                </button>
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-foreground">Enter your vault password</p>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleOpenR2()}
                      placeholder="Vault password"
                      autoFocus
                      className="w-full px-3 py-2.5 pr-9 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="flex items-start gap-2 text-destructive text-[11px]">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
                <button
                  onClick={handleOpenR2}
                  disabled={!password || loading}
                  className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {loading
                    ? <><Loader2 size={14} className="animate-spin" /> Opening…</>
                    : <><Cloud size={14} /> Open Vault</>
                  }
                </button>
              </div>
            ) : (
              /* Create new vault: set password */
              <div className="space-y-3 text-left">
                <button
                  onClick={() => setCloudStep('choose')}
                  className="text-[11px] text-primary flex items-center gap-1 hover:opacity-80"
                >
                  ← Back
                </button>
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-foreground">Create a vault password</p>
                  <p className="text-[11px] text-muted-foreground">This password encrypts your notes. It cannot be recovered if lost.</p>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="New vault password (min 8 chars)"
                      autoFocus
                      className="w-full px-3 py-2.5 pr-9 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateR2()}
                    placeholder="Confirm password"
                    className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                  />
                </div>
                {error && (
                  <div className="flex items-start gap-2 text-destructive text-[11px]">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
                <button
                  onClick={handleCreateR2}
                  disabled={!password || !confirmPw || loading}
                  className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {loading
                    ? <><Loader2 size={14} className="animate-spin" /> Creating…</>
                    : <><KeyRound size={14} /> Create Cloud Vault</>
                  }
                </button>
              </div>
            )}

            {/* Feature grid */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { icon: <Cloud size={13} />,    label: 'Cloud Sync', desc: 'All devices' },
                { icon: <Shield size={13} />,   label: 'Encrypted',  desc: 'AES-256-GCM' },
                { icon: <WifiOff size={13} />,  label: 'Offline',    desc: 'Works offline' },
              ].map(f => (
                <div key={f.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-primary">{f.icon}</span>
                  <span className="text-[10px] font-semibold text-foreground/80">{f.label}</span>
                  <span className="text-[9px] text-muted-foreground">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

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

  // ── Desktop: cloud-vault mode (opted in via button below) ────────────────

  if (desktopCloudMode) {
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
                Ballpoint <span className="text-primary">Cloud</span>
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your notes, encrypted and synced via cloud storage. Works on all devices.
              </p>
              {user && (
                <p className="text-xs text-muted-foreground/60">
                  Signed in as <span className="font-medium text-foreground/70">{user.email}</span>
                </p>
              )}
            </div>

            {!r2Configured ? (
              <div className="bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20 text-left">
                <h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
                  <CloudOff size={14} /> Cloud storage not available
                </h3>
                <p className="text-xs opacity-80">
                  R2 cloud storage is not configured on this server.
                </p>
              </div>
            ) : cloudStep === 'choose' ? (
              <div className="space-y-3">
                <button
                  onClick={() => { setCloudStep('open'); setError(null); setPassword(''); }}
                  className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20"
                >
                  <Cloud size={15} /> Open Existing Cloud Vault
                </button>
                <button
                  onClick={() => { setCloudStep('create'); setError(null); setPassword(''); setConfirmPw(''); }}
                  className="w-full h-10 rounded-lg bg-muted text-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted/80 active:opacity-80 transition-opacity border border-border"
                >
                  <KeyRound size={15} /> Create New Cloud Vault
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Notes are AES-256-GCM encrypted before leaving your device.
                </p>
                <button
                  onClick={() => { setDesktopCloudMode(false); setError(null); setCloudStep('choose'); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
                >
                  ← Use local folder instead
                </button>
              </div>
            ) : cloudStep === 'open' ? (
              <div className="space-y-3 text-left">
                <button onClick={() => setCloudStep('choose')} className="text-[11px] text-primary flex items-center gap-1 hover:opacity-80">← Back</button>
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-foreground">Enter your vault password</p>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleOpenR2()} placeholder="Vault password" autoFocus
                      className="w-full px-3 py-2.5 pr-9 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                {(error ?? r2Error) && <p className="text-[11px] text-destructive">{error ?? r2Error}</p>}
                <button onClick={handleOpenR2} disabled={!password || loading || r2Status === 'syncing'}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  {(loading || r2Status === 'syncing') ? <><Loader2 size={14} className="animate-spin" /> Opening…</> : <><Cloud size={14} /> Open Cloud Vault</>}
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-left">
                <button onClick={() => setCloudStep('choose')} className="text-[11px] text-primary flex items-center gap-1 hover:opacity-80">← Back</button>
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-foreground">Choose a vault password</p>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 8 chars)" autoFocus
                      className="w-full px-3 py-2.5 pr-9 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Confirm password"
                    className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
                  />
                </div>
                {(error ?? r2Error) && <p className="text-[11px] text-destructive">{error ?? r2Error}</p>}
                <button onClick={handleCreateR2} disabled={!password || password !== confirmPw || password.length < 8 || loading || r2Status === 'syncing'}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  {(loading || r2Status === 'syncing') ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : <><KeyRound size={14} /> Create Cloud Vault</>}
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { icon: <Cloud size={13} />,    label: 'Cloud Sync', desc: 'All devices' },
                { icon: <Shield size={13} />,   label: 'Encrypted',  desc: 'AES-256-GCM' },
                { icon: <WifiOff size={13} />,  label: 'Offline',    desc: 'Works offline' },
              ].map(f => (
                <div key={f.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-primary">{f.icon}</span>
                  <span className="text-[10px] font-semibold text-foreground/80">{f.label}</span>
                  <span className="text-[9px] text-muted-foreground">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: normal folder picker ─────────────────────────────────────────

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
            <p className="text-sm text-muted-foreground leading-relaxed">
              Select a folder on your computer to store your notes as plain Markdown files.
            </p>
            {user && (
              <p className="text-xs text-muted-foreground/60">
                Logged in as <span className="font-medium text-foreground/70">{user.email}</span>
              </p>
            )}
          </div>

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
              { icon: <WifiOff size={13} />,   label: 'Offline',    desc: 'Works everywhere' },
            ].map(f => (
              <div key={f.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/40 border border-border/40">
                <span className="text-primary">{f.icon}</span>
                <span className="text-[10px] font-semibold text-foreground/80">{f.label}</span>
                <span className="text-[9px] text-muted-foreground">{f.desc}</span>
              </div>
            ))}
          </div>

          {r2Configured && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}
          {r2Configured && (
            <button
              onClick={() => { setDesktopCloudMode(true); setError(null); setCloudStep('choose'); setPassword(''); setConfirmPw(''); }}
              className="w-full h-9 rounded-lg bg-muted text-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted/80 transition-colors border border-border"
            >
              <Cloud size={14} /> Use Cloud Vault (R2)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
