import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { WelcomeScreen } from '../components/WelcomeScreen';
import { Sidebar } from '../components/Sidebar';
import { NoteList } from '../components/NoteList';
import { Editor } from '../components/Editor';
import { CommandPalette } from '../components/CommandPalette';

// ─── Vault Lock Screen ────────────────────────────────────────────────────────
function VaultLockScreen() {
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
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="w-72 p-6 rounded-2xl border border-border bg-card shadow-2xl space-y-4">
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
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
        />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        <button
          onClick={handleUnlock}
          disabled={!password || loading}
          className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {loading ? 'Unlocking…' : 'Unlock Vault'}
        </button>
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
  const init              = useNotesStore(s => s.init);
  const reset             = useNotesStore(s => s.reset);

  const [cmdOpen, setCmdOpen] = useState(false);

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

  if (!vaultHandle) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
        <WelcomeScreen />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  // Vault is open but locked — show password prompt
  if (isVaultEncrypted && !encryptionKey) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
        <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
        <VaultLockScreen />
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />
      <NoteList />
      <Editor />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
