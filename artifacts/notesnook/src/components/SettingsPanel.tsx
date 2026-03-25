import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud, CloudOff, Upload, Download, RefreshCw, CheckCircle2,
  AlertCircle, Clock, Copy, X, ChevronDown, ChevronRight,
  Wallet, Shield, ShieldCheck, FlaskConical, FileText, FolderOpen,
  ArrowLeft,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { cn } from '../lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import type { NoteSnapshot } from '../lib/syncEncryption';

function truncateCid(cid: string) {
  if (cid.length <= 16) return cid;
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function downloadAsZip(snapshots: NoteSnapshot[], label: string) {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const snap of snapshots) {
    const safeName = snap.title.replace(/[/\\?%*:|"<>]/g, '-') || snap.id;
    const key = `${safeName}.md`;
    const deduped = files[key] ? `${safeName}-${snap.id.slice(0, 6)}.md` : key;
    files[deduped] = strToU8(snap.content);
  }
  const zipped = zipSync(files);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ballpoint-restore-${label}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

type RestoreStep =
  | { kind: 'idle' }
  | { kind: 'decrypting'; cid: string }
  | { kind: 'preview'; cid: string; snapshots: NoteSnapshot[]; backupDate: number }
  | { kind: 'writing' }
  | { kind: 'done'; count: number; via: 'vault' | 'zip' }
  | { kind: 'error'; message: string };

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();

  const syncStatus         = useNotesStore(s => s.syncStatus);
  const syncError          = useNotesStore(s => s.syncError);
  const lastSyncRecord     = useNotesStore(s => s.lastSyncRecord);
  const syncHistory        = useNotesStore(s => s.syncHistory);
  const walletAddress      = useNotesStore(s => s.walletAddress);
  const hasLighthouseKey   = useNotesStore(s => s.hasLighthouseKey);
  const syncEncryptionMode = useNotesStore(s => s.syncEncryptionMode);
  const vaultHandle        = useNotesStore(s => s.vaultHandle);

  const initSync             = useNotesStore(s => s.initSync);
  const backupNow            = useNotesStore(s => s.backupNow);
  const previewRestoreFromCid = useNotesStore(s => s.previewRestoreFromCid);
  const restoreSnapshots     = useNotesStore(s => s.restoreSnapshots);
  const loadHistory          = useNotesStore(s => s.loadSyncHistory);
  const setDevSyncMode       = useNotesStore(s => s.setDevSyncMode);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [restoreStep, setRestoreStep] = useState<RestoreStep>({ kind: 'idle' });

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

  const handleDecryptPreview = useCallback(async (cid: string, backupDate: number) => {
    if (!token) return;
    setRestoreStep({ kind: 'decrypting', cid });
    try {
      const snapshots = await previewRestoreFromCid(token, cid);
      setRestoreStep({ kind: 'preview', cid, snapshots, backupDate });
    } catch (err: any) {
      setRestoreStep({ kind: 'error', message: err.message ?? 'Failed to decrypt backup' });
    }
  }, [token, previewRestoreFromCid]);

  const handleWriteToVault = useCallback(async () => {
    if (restoreStep.kind !== 'preview') return;
    const { snapshots } = restoreStep;
    setRestoreStep({ kind: 'writing' });
    try {
      await restoreSnapshots(snapshots);
      setRestoreStep({ kind: 'done', count: snapshots.length, via: 'vault' });
    } catch (err: any) {
      setRestoreStep({ kind: 'error', message: err.message ?? 'Restore failed' });
    }
  }, [restoreStep, restoreSnapshots]);

  const handleDownloadZip = useCallback(async () => {
    if (restoreStep.kind !== 'preview') return;
    const { snapshots, backupDate } = restoreStep;
    const label = format(new Date(backupDate), 'yyyy-MM-dd');
    await downloadAsZip(snapshots, label);
    setRestoreStep({ kind: 'done', count: snapshots.length, via: 'zip' });
  }, [restoreStep]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCid(text);
    setTimeout(() => setCopiedCid(null), 1500);
  };

  const isWorking = syncStatus === 'uploading' || syncStatus === 'downloading';
  const isRestoreActive = restoreStep.kind !== 'idle';

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[95%] max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          {isRestoreActive && restoreStep.kind !== 'done' && restoreStep.kind !== 'error' ? (
            <button
              onClick={() => setRestoreStep({ kind: 'idle' })}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft size={14} />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cloud size={16} className="text-primary" />
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {restoreStep.kind === 'preview' ? 'Restore Preview' :
               restoreStep.kind === 'done' ? 'Restore Complete' :
               restoreStep.kind === 'error' ? 'Restore Error' :
               'Storage & Sync'}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {restoreStep.kind === 'preview'
                ? `${restoreStep.snapshots.length} note${restoreStep.snapshots.length !== 1 ? 's' : ''} in this backup`
                : 'Lighthouse IPFS cloud backup'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Restore: Decrypting spinner ── */}
        {restoreStep.kind === 'decrypting' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Decrypting backup from IPFS…</p>
            <p className="text-[10px] text-muted-foreground/50">Recovering Kavach key shards</p>
          </div>
        )}

        {/* ── Restore: Writing spinner ── */}
        {restoreStep.kind === 'writing' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Writing notes to vault…</p>
          </div>
        )}

        {/* ── Restore: Done ── */}
        {restoreStep.kind === 'done' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 size={24} className="text-green-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {restoreStep.count} note{restoreStep.count !== 1 ? 's' : ''} restored
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {restoreStep.via === 'zip'
                  ? 'Downloaded as a ZIP file with .md notes inside'
                  : 'Notes written to your vault folder'}
              </p>
            </div>
            <button
              onClick={() => setRestoreStep({ kind: 'idle' })}
              className="mt-2 px-4 py-2 rounded-lg bg-muted text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              Back to sync
            </button>
          </div>
        )}

        {/* ── Restore: Error ── */}
        {restoreStep.kind === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle size={24} className="text-destructive" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Restore failed</p>
              <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">{restoreStep.message}</p>
            </div>
            <button
              onClick={() => setRestoreStep({ kind: 'idle' })}
              className="mt-2 px-4 py-2 rounded-lg bg-muted text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          </div>
        )}

        {/* ── Restore: Preview ── */}
        {restoreStep.kind === 'preview' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 pt-4 pb-2 shrink-0">
              <p className="text-[11px] text-muted-foreground">
                Backed up {formatDistanceToNow(new Date(restoreStep.backupDate), { addSuffix: true })}. Choose how to get your notes:
              </p>
            </div>

            {/* Note list */}
            <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-1 min-h-0">
              {restoreStep.snapshots.map(snap => (
                <div key={snap.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
                  <FileText size={11} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-foreground/90 truncate font-medium">{snap.title || 'Untitled'}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {snap.content.length > 0
                        ? `${snap.content.split('\n').length} line${snap.content.split('\n').length !== 1 ? 's' : ''}`
                        : 'Empty'}
                      {snap.lastModified ? ` · ${formatDistanceToNow(new Date(snap.lastModified), { addSuffix: true })}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="px-6 py-4 border-t border-border shrink-0 space-y-2">
              <button
                onClick={handleDownloadZip}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors"
              >
                <Download size={13} /> Download as ZIP (.md files)
              </button>

              <button
                onClick={handleWriteToVault}
                disabled={!vaultHandle}
                title={!vaultHandle ? 'Open your vault folder first' : undefined}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition-colors",
                  vaultHandle
                    ? "bg-muted text-foreground hover:bg-muted/70"
                    : "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                <FolderOpen size={13} />
                {vaultHandle ? 'Write to Vault' : 'Write to Vault (open vault first)'}
              </button>

              <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
                ZIP contains one .md file per note · Write to Vault overwrites matching files
              </p>
            </div>
          </div>
        )}

        {/* ── Main panel (idle) ── */}
        {restoreStep.kind === 'idle' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

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

            {/* Version history / restore */}
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
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
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
                          <p className="text-[9px] text-muted-foreground/50">{record.noteCount} notes · {record.encryptionMode}</p>
                        </div>

                        <button
                          onClick={() => handleDecryptPreview(record.cid, record.timestamp)}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-all shrink-0"
                        >
                          <Download size={9} /> Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* No backups yet */}
            {syncHistory.length === 0 && syncStatus !== 'uploading' && (
              <div className="flex flex-col items-center py-6 text-muted-foreground/40">
                <CloudOff size={24} className="mb-2 opacity-40" />
                <p className="text-[11px]">No backups yet</p>
                <p className="text-[10px] mt-0.5 opacity-70">Click "Backup Now" to create your first encrypted cloud backup</p>
              </div>
            )}

          </div>
        )}

        {/* Footer — only on idle */}
        {restoreStep.kind === 'idle' && (
          <div className="px-6 py-3 border-t border-border shrink-0">
            <p className="text-[10px] text-muted-foreground/50 text-center">
              Notes are encrypted before leaving your device · Private key stays on server
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
