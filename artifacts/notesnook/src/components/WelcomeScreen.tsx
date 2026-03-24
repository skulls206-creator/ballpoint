import { useState } from 'react';
import { FolderOpen, HardDrive, Shield, Zap, Lock, Menu, AlertCircle, Loader2 } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { isFileSystemSupported } from '../lib/fileSystem';

function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

export function WelcomeScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const openNewVault = useNotesStore(s => s.openNewVault);
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const inIframe = isInIframe();

  const handleOpen = async () => {
    if (!user) return;
    setError(null);
    setLoading(true);
    try {
      await openNewVault(user.id);
    } catch (e: any) {
      if (e?.name === 'SecurityError') {
        setError(
          "Browser blocked the folder picker — this usually means the app is inside an " +
          "iframe without file-system permission. Open ballpoint.one directly in its own " +
          "tab, or use the folder button in Hollr's app header."
        );
      } else {
        setError(e?.message ?? 'Something went wrong opening the folder.');
      }
    } finally {
      setLoading(false);
    }
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
        <span className="ml-2 text-sm font-semibold text-foreground">Ballpoint.one</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full text-center space-y-6">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Zap size={22} strokeWidth={1.5} />
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              Local<span className="text-primary">Notes</span>
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

          {/* Action area */}
          {!isFileSystemSupported ? (
            <div className="bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20 text-left">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
                <Shield size={14} /> Browser not supported
              </h3>
              <p className="text-xs opacity-80">Use Chrome, Edge, or a Chromium-based browser for File System Access API support.</p>
            </div>
          ) : inIframe ? (
            /* Inside Hollr / KHURK OS — proxy vault mode */
            <div className="space-y-3">
              {/* Pulsing "listening" indicator */}
              <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 px-4 py-3 rounded-lg">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
                <p className="text-[12.5px] font-medium text-foreground">
                  Listening for KHURK OS to share a folder…
                </p>
              </div>

              {/* What Hollr needs to do */}
              <div className="bg-muted/40 border border-border/60 rounded-lg px-3 py-2.5 text-left space-y-1.5">
                <p className="text-[10.5px] font-semibold text-foreground/70 uppercase tracking-wide">Hollr must send:</p>
                <pre className="text-[10px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all font-mono">{`iframe.contentWindow.postMessage({
  type: 'khurk:vault-open',
  name: dir.name,
  files: [{ name, content, lastModified }]
}, '*')`}</pre>
                <p className="text-[10px] text-muted-foreground/60">
                  Handles don't work cross-origin — Hollr must read file <em>contents</em> and send them here.
                </p>
              </div>
            </div>
          ) : (
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
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 text-destructive p-3 rounded-lg border border-destructive/20 text-left">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">{error}</p>
            </div>
          )}

          {/* Feature grid */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            {[
              { icon: <HardDrive size={13} />, label: '100% Local', desc: '.md files on disk' },
              { icon: <Lock size={13} />,      label: 'Private',    desc: 'No cloud sync'    },
              { icon: <Zap size={13} />,       label: 'Offline',    desc: 'Works everywhere' },
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
