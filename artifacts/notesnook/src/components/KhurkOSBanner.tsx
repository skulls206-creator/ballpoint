import { useEffect, useState } from 'react';
import { X, FolderCheck } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import type { AccentColor } from '../lib/metadata';

const SESSION_KEY = 'ballpoint-khurk-dismissed';

// Map an arbitrary hex colour from KHURK OS to the nearest built-in accent
function hexToAccent(hex: string): AccentColor {
  if (!hex || hex.length < 7) return 'indigo';
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    if (h < 20 || h >= 345) return 'rose';
    if (h < 40)  return 'orange';
    if (h < 65)  return 'amber';
    if (h < 150) return 'green';
    if (h < 175) return 'teal';
    if (h < 205) return 'cyan';
    if (h < 235) return 'blue';
    if (h < 270) return 'indigo';
    if (h < 310) return 'violet';
    return 'pink';
  } catch {
    return 'indigo';
  }
}

function isEmbedded(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

type KhurkMsg = { type: 'KHURK_THEME'; theme?: 'dark' | 'light'; accent?: string };

export function KhurkOSBanner() {
  const [show, setShow]               = useState(false);
  const [pending, setPending]         = useState<KhurkMsg | null>(null);
  const [vaultToast, setVaultToast]   = useState<string | null>(null);

  const theme               = useNotesStore(s => s.theme);
  const toggleTheme         = useNotesStore(s => s.toggleTheme);
  const setAccent           = useNotesStore(s => s.setAccentColor);

  // ── Theme banner (shown once per session when embedded) ─────────────────────
  useEffect(() => {
    if (!isEmbedded()) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    setShow(true);

    const onMessage = (e: MessageEvent) => {
      const ok =
        e.origin === 'https://khurk.services' ||
        e.origin.endsWith('.khurk.services');
      if (!ok) return;
      const d = e.data as KhurkMsg;
      if (d?.type === 'KHURK_THEME') {
        setPending(d);
        if (!sessionStorage.getItem(SESSION_KEY)) setShow(true);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ── Folder bridge — always active when embedded ──────────────────────────────
  // Hollr reads the folder on the parent page (where it has permission) and sends
  // file CONTENTS here via postMessage. Ballpoint lives purely in memory when
  // embedded; writes are sent back to Hollr via ballpoint:write-file etc.
  //
  // Expected message from Hollr:
  // { type: 'khurk:vault-open', name: string, files: [{name, content, lastModified?}] }
  useEffect(() => {
    if (!isEmbedded()) return;

    const onFsMessage = async (e: MessageEvent) => {
      const ok =
        e.origin === 'https://khurk.services' ||
        e.origin.endsWith('.khurk.services');
      if (!ok) return;

      const type = e.data?.type as string | undefined;

      // ── Old handle-based message: Hollr needs to be updated ──────────────────
      if (type === 'khurk:fs-directory') {
        console.warn('[Ballpoint] Received khurk:fs-directory (old format). Hollr must be updated to send khurk:vault-open with file contents instead of a FileSystemDirectoryHandle.');
        setVaultToast('⚠️ Hollr needs to be updated — it sent a folder handle instead of file contents. See console for details.');
        setTimeout(() => setVaultToast(null), 9000);
        return;
      }

      // ── Debug: log any other khurk message we don't recognise ────────────────
      if (type !== 'khurk:vault-open' && type !== 'KHURK_THEME') {
        console.info('[Ballpoint] Received unknown message from Hollr:', type, e.data);
        return;
      }

      if (type !== 'khurk:vault-open') return;

      const files = e.data.files as { name: string; content: string; lastModified?: number }[];
      const name  = (e.data.name as string | undefined) ?? 'Vault';
      if (!Array.isArray(files)) {
        console.error('[Ballpoint] khurk:vault-open received but "files" is not an array:', e.data);
        setVaultToast('⚠️ Hollr sent vault-open but no file list. Check your Hollr code.');
        setTimeout(() => setVaultToast(null), 7000);
        return;
      }

      const { userId, openVaultFromProxy } = useNotesStore.getState();
      if (!userId) {
        setVaultToast('⚠️ Log in to Ballpoint first, then share the folder from Hollr.');
        setTimeout(() => setVaultToast(null), 6000);
        return;
      }

      await openVaultFromProxy(userId, name, files);

      setVaultToast(`📁 "${name}" — ${files.length} note${files.length !== 1 ? 's' : ''} loaded`);
      setTimeout(() => setVaultToast(null), 4000);
    };

    window.addEventListener('message', onFsMessage);
    return () => window.removeEventListener('message', onFsMessage);
  }, []);

  const apply = () => {
    // Switch to dark if not already
    if (theme !== 'dark') toggleTheme();
    // Use accent from the postMessage if available, otherwise default to indigo
    setAccent(pending?.accent ? hexToAccent(pending.accent) : 'indigo');
    close();
  };

  const close = () => {
    setShow(false);
    sessionStorage.setItem(SESSION_KEY, '1');
  };

  return (
    <>
    {/* Vault-connected confirmation toast */}
    {vaultToast && (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-card border border-border shadow-xl shadow-black/40 backdrop-blur-sm">
          <FolderCheck size={15} className="text-green-500 shrink-0" />
          <span className="text-[13px] font-medium text-foreground">{vaultToast}</span>
        </div>
      </div>
    )}

    {/* KHURK OS theme banner */}
    {show && (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      <div className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl bg-card border border-border shadow-2xl shadow-black/50 backdrop-blur-sm">
        {/* Icon */}
        <div className="shrink-0 w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-base select-none">
          🪟
        </div>

        {/* Text + actions */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <p className="text-[12.5px] font-medium text-foreground leading-snug">
            Looks like you're in{' '}
            <span className="text-primary font-semibold">KHURK OS</span>
            {' '}— want to change the theme to fit?
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={apply}
              className="px-3 py-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              Yes, match it
            </button>
            <button
              onClick={close}
              className="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              Not now
            </button>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={close}
          className="shrink-0 mt-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
    )}
    </>
  );
}
