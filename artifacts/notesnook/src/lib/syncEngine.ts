/**
 * Sync engine: orchestrates Lighthouse backup and restore.
 *
 * Encryption flow (LIGHTHOUSE mode):
 *   1. POST /sync/sign "ballpoint-sync-key-v1" → deterministic ETH signature
 *   2. SHA-256(signature) → AES-256-GCM key (tied to ETH wallet, server-side key)
 *   3. Encrypt serialized notes bundle
 *   4. Upload to Lighthouse via POST /sync/upload
 *   5. Store SyncRecord in IndexedDB
 *
 * Restore flow:
 *   1. Re-derive same key via /sync/sign
 *   2. Download ciphertext from IPFS via GET /sync/download/:cid
 *   3. Decrypt and deserialize
 */

import { get, set } from "idb-keyval";
import {
  SYNC_ENCRYPTION_MODE, SYNC_KEY_DERIVATION_MESSAGE,
  serializeNotes, deserializeNotes,
  deriveKeyFromSignature, deriveLocalFallbackKey,
  encryptForSync, decryptFromSync,
  NoteSnapshot,
} from "./syncEncryption";
import {
  signMessage, uploadEncryptedBlob, downloadEncryptedBlob,
} from "./lighthouseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncRecord {
  cid: string;
  timestamp: number;
  noteCount: number;
  walletAddress: string;
  encryptionMode: string;
  sizeBytes?: number;
}

function syncHistoryKey(userId: number) {
  return `ballpoint-sync-history-${userId}`;
}

// ─── Key derivation (mode-aware) ──────────────────────────────────────────────

async function deriveSyncKey(token: string, userId: number): Promise<CryptoKey> {
  if (SYNC_ENCRYPTION_MODE === "LIGHTHOUSE") {
    const { signature } = await signMessage(token, SYNC_KEY_DERIVATION_MESSAGE);
    return deriveKeyFromSignature(signature);
  }
  return deriveLocalFallbackKey(userId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Backup all notes to Lighthouse IPFS (encrypted).
 * Returns the new SyncRecord.
 */
export async function backupNow(
  token: string,
  userId: number,
  notes: NoteSnapshot[],
): Promise<SyncRecord> {
  const key = await deriveSyncKey(token, userId);
  const serialized = serializeNotes(notes);
  const encrypted = await encryptForSync(serialized, key);

  let walletAddress = "local";
  if (SYNC_ENCRYPTION_MODE === "LIGHTHOUSE") {
    const { address } = await signMessage(token, SYNC_KEY_DERIVATION_MESSAGE);
    walletAddress = address;
  }

  const cid = await uploadEncryptedBlob(token, encrypted);

  const record: SyncRecord = {
    cid,
    timestamp: Date.now(),
    noteCount: notes.length,
    walletAddress,
    encryptionMode: SYNC_ENCRYPTION_MODE,
    sizeBytes: encrypted.byteLength,
  };

  const history = await loadSyncHistory(userId);
  history.unshift(record);
  await set(syncHistoryKey(userId), history.slice(0, 50));

  return record;
}

/**
 * Restore notes from a Lighthouse CID.
 * Returns the decrypted note snapshots.
 */
export async function restoreFromCid(
  token: string,
  userId: number,
  cid: string,
): Promise<NoteSnapshot[]> {
  const key = await deriveSyncKey(token, userId);
  const encrypted = await downloadEncryptedBlob(token, cid);
  const decrypted = await decryptFromSync(encrypted, key);
  return deserializeNotes(decrypted);
}

/** Load the backup history for a user from IndexedDB. */
export async function loadSyncHistory(userId: number): Promise<SyncRecord[]> {
  return (await get<SyncRecord[]>(syncHistoryKey(userId))) ?? [];
}
