import { useState, useEffect, useCallback } from 'react';
import {
  Cloud, CloudOff, Upload, Download, RefreshCw, CheckCircle2,
  AlertCircle, Clock, Copy, X, ChevronDown, ChevronRight,
  Wallet, Shield, ShieldCheck, FlaskConical,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

function truncateCid(cid: string) {
  if (cid.length <= 16) return cid;
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();

  const syncStatus        = useNotesStore(s => s.syncStatus);
  const syncError         = useNotesStore(s => s.syncError);
  const lastSyncRecord    = useNotesStore(s => s.lastSyncRecord);
  const syncHistory       = useNotesStore(s => s.syncHistory);
  const walletAddress     = useNotesStore(s => s.walletAddress);
  const hasLighthouseKey  = useNotesStore(s => s.hasLighthouseKey);
  const syncEncryptionMode = useNotesStore(s => s.syncEncryptionMode);

  const initSync        = useNotesStore(s => s.initSync);
  const backupNow       = useNotesStore(s => s.backupNow);
  const restoreFromCid  = useNotesStore(s => s.restoreFromCid);
  const loadHistory     = useNotesStore(s => s.loadSyncHistory);
  const setDevSyncMode  = useNotesStore(s => s.setDevSyncMode);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  // Load sync info on mount
  useEffect(() => {
    if (token) {
      initSync(token);
      loadHistory();
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackup = useCallback(async () => {
    if (!token) return;
    await backupNow(token);
  }, [token, backupNow]);

  const handleRestore = useCallback(async (cid: string) => {
    if (!token) return;
    await restoreFromCid(token, cid);
    setConfirmRestore(null);
  }, [token, restoreFromCid]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCid(text);
    setTimeout(() => setCopiedCid(null), 1500);
  };

  const isWorking = syncStatus === 'uploading' || syncStatus === 'downloading';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[95%] max-w-4xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-8 py-5 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Cloud size={16} className="text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Storage & Sync</h2>
            <p className="text-[11px] text-muted-foreground">Lighthouse IPFS cloud backup</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">

          {/* Encryption mode badge + dev toggle */}
          <div className="space-y-2">
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border",
              syncEncryptionMode === 'LIGHTHOUSE'
                ? "bg-primary/5 border-primary/20"
                : "bg-amber-500/5 border-amber-500/30"
            )}>
              {syncEncryptionMode === 'LIGHTHOUSE'
                ? <ShieldCheck size={13} className="text-primary shrink-0" />
                : <FlaskConical size={13} className="text-amber-500 shrink-0" />}
              <div className="flex-1">
                <p className="text-[11px] font-medium text-foreground">
                  {syncEncryptionMode === 'LIGHTHOUSE'
                    ? 'Kavach + Lighthouse — encrypted via ETH wallet'
                    : 'Local WebCrypto — DEV/TESTING ONLY'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {syncEncryptionMode === 'LIGHTHOUSE'
                    ? 'BLS key shards stored on Kavach nodes'
                    : 'Local random seed — not wallet-tied, not production-safe'}
                </p>
              </div>
              {syncEncryptionMode !== 'LIGHTHOUSE' && (
                <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">DEV</span>
              )}
            </div>

            {/* Dev mode toggle — clearly labeled as dev/testing only */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-border bg-muted/20">
              <div className="flex items-center gap-1.5">
                <FlaskConical size={11} className="text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">
                  Local WebCrypto fallback <span className="text-amber-500 font-semibold">(dev only)</span>
                </p>
              </div>
              <button
                onClick={() => setDevSyncMode(syncEncryptionMode === 'LOCAL_WEBCRYPTO' ? 'LIGHTHOUSE' : 'LOCAL_WEBCRYPTO')}
                className={cn(
                  "relative w-8 h-4 rounded-full transition-colors shrink-0",
                  syncEncryptionMode === 'LOCAL_WEBCRYPTO' ? "bg-amber-500" : "bg-muted-foreground/20"
                )}
                title="Toggle LOCAL_WEBCRYPTO mode for offline testing"
              >
                <span className={cn(
                  "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform",
                  syncEncryptionMode === 'LOCAL_WEBCRYPTO' ? "translate-x-4" : "translate-x-0.5"
                )} />
              </button>
            </div>
          </div>

          {/* Wallet info */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-2 font-semibold">ETH Wallet</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30">
              <Wallet size={12} className="text-muted-foreground shrink-0" />
              {walletAddress ? (
                <code className="text-[10px] text-foreground/80 flex-1 truncate font-mono">
                  {walletAddress}
                </code>
              ) : (
                <span className="text-[11px] text-muted-foreground flex-1 italic">Loading…</span>
              )}
            </div>
          </div>

          {/* Lighthouse API key status */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-2 font-semibold">Lighthouse API</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30">
              {hasLighthouseKey ? (
                <>
                  <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                  <span className="text-[11px] text-foreground/80 flex-1">API key configured</span>
                  <Shield size={10} className="text-muted-foreground" />
                </>
              ) : (
                <>
                  <AlertCircle size={12} className="text-amber-500 shrink-0" />
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 flex-1">LIGHTHOUSE_API_KEY not set on server</span>
                </>
              )}
            </div>
          </div>

          {/* Backup Now */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-2 font-semibold">Backup</p>
            <button
              onClick={handleBackup}
              disabled={isWorking || !hasLighthouseKey}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition-colors",
                isWorking || !hasLighthouseKey
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {syncStatus === 'uploading' ? (
                <><RefreshCw size={13} className="animate-spin" /> Uploading…</>
              ) : (
                <><Upload size={13} /> Backup Now</>
              )}
            </button>

            {syncStatus === 'error' && syncError && (
              <div className="mt-2 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle size={11} className="text-destructive shrink-0 mt-0.5" />
                <p className="text-[10px] text-destructive">{syncError}</p>
              </div>
            )}

            {lastSyncRecord && syncStatus !== 'error' && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20">
                  <CheckCircle2 size={11} className="text-green-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground/80">
                      Last backup {formatDistanceToNow(new Date(lastSyncRecord.timestamp), { addSuffix: true })}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="text-[10px] text-muted-foreground font-mono truncate">
                        {truncateCid(lastSyncRecord.cid)}
                      </code>
                      <button
                        onClick={() => copyToClipboard(lastSyncRecord.cid)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Copy CID"
                      >
                        {copiedCid === lastSyncRecord.cid ? (
                          <CheckCircle2 size={10} className="text-green-500" />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </div>
                  </div>
                  {lastSyncRecord.sizeBytes && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatBytes(lastSyncRecord.sizeBytes)}</span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground px-1">
                  {lastSyncRecord.noteCount} note{lastSyncRecord.noteCount !== 1 ? 's' : ''} · {lastSyncRecord.encryptionMode}
                </p>
              </div>
            )}
          </div>

          {/* Version history */}
          {syncHistory.length > 0 && (
            <div>
              <button
                onClick={() => setHistoryOpen(p => !p)}
                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold mb-2 hover:text-muted-foreground transition-colors w-full"
              >
                {historyOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Cloud Versions ({syncHistory.length})
              </button>

              {historyOpen && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {syncHistory.map((record, i) => (
                    <div key={record.cid + i} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20 group">
                      <Clock size={10} className="text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-foreground/70">
                          {formatDistanceToNow(new Date(record.timestamp), { addSuffix: true })}
                        </p>
                        <div className="flex items-center gap-1">
                          <code className="text-[9px] text-muted-foreground/60 font-mono truncate">
                            {truncateCid(record.cid)}
                          </code>
                          <button
                            onClick={() => copyToClipboard(record.cid)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all shrink-0"
                          >
                            {copiedCid === record.cid ? (
                              <CheckCircle2 size={9} className="text-green-500" />
                            ) : (
                              <Copy size={9} />
                            )}
                          </button>
                        </div>
                        <p className="text-[9px] text-muted-foreground/50">{record.noteCount} notes</p>
                      </div>

                      {/* Restore */}
                      {confirmRestore === record.cid ? (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => handleRestore(record.cid)}
                            disabled={isWorking}
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                          >
                            {syncStatus === 'downloading' ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmRestore(null)}
                            className="px-1.5 py-0.5 rounded text-[9px] text-muted-foreground hover:bg-muted"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRestore(record.cid)}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all shrink-0"
                        >
                          <Download size={9} /> Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No backups yet */}
          {syncHistory.length === 0 && syncStatus !== 'uploading' && (
            <div className="flex flex-col items-center py-4 text-muted-foreground/40">
              <CloudOff size={24} className="mb-2 opacity-40" />
              <p className="text-[11px]">No backups yet</p>
              <p className="text-[10px] mt-0.5 opacity-70">Click "Backup Now" to create your first encrypted cloud backup</p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-border shrink-0">
          <p className="text-[10px] text-muted-foreground/50 text-center">
            Notes are encrypted before leaving your device · Private key stays on server
          </p>
        </div>
      </div>
    </div>
  );
}
