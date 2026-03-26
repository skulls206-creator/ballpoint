/**
 * Sync engine: orchestrates Lighthouse + Kavach encrypted backup and restore.
 *
 * LIGHTHOUSE mode (default) — full Kavach flow via @lighthouse-web3/sdk:
 *   Backup:
 *     1. GET /sync/wallet → wallet address + Lighthouse API key
 *     2. lighthouse.getAuthMessage(address) → Kavach challenge
 *     3. POST /sync/sign with challenge → ETH signature (server-side key)
 *     4. lighthouse.uploadEncrypted([file], apiKey, address, signature)
 *          - kavach.generate() creates BLS master key + key shards
 *          - File encrypted locally with master key (PBKDF2 + AES-GCM)
 *          - Ciphertext uploaded to Lighthouse IPFS → returns CID
 *          - Key shards saved to Kavach nodes (wallet-address access control)
 *
 *   Restore:
 *     1. GET /sync/wallet → wallet address
 *     2. lighthouse.getAuthMessage(address) → Kavach challenge
 *     3. POST /sync/sign with challenge → ETH signature
 *     4. lighthouse.fetchEncryptionKey(cid, address, signature)
 *          - Recovers key shards from Kavach nodes
 *          - kavach.recoverKey(shards) reconstructs BLS master key
 *     5. lighthouse.decryptFile(cid, masterKey)
 *          - Downloads ciphertext from IPFS gateway
 *          - Decrypts using recovered master key → JSON blob → NoteSnapshot[]
 *
 * LOCAL_WEBCRYPTO mode (dev/testing fallback):
 *   Uses AES-256-GCM with a locally-stored random seed key.
 *   Notes are encrypted/decrypted entirely in-browser; no Kavach or Lighthouse involved.
 *   NOT wallet-tied, not suitable for production.
 */

import { get, set } from "idb-keyval";
import {
  getSyncEncryptionMode,
  serializeNotes,
  deserializeNotes,
  deriveLocalFallbackKey,
  encryptForLocalSync,
  decryptForLocalSync,
  NoteSnapshot,
} from "./syncEncryption";
import {
  getWalletInfo,
  uploadEncryptedNotes,
  decryptNotesFromCid,
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Backup all notes to Lighthouse IPFS using Kavach encryption (LIGHTHOUSE mode)
 * or local AES-256-GCM (LOCAL_WEBCRYPTO mode).
 * Returns the new SyncRecord saved to IndexedDB history.
 */
export async function backupNow(
  token: string,
  userId: number,
  notes: NoteSnapshot[],
): Promise<SyncRecord> {
  const json = serializeNotes(notes);

  let cid: string;
  let walletAddress: string;
  let sizeBytes: number;

  if (getSyncEncryptionMode() === "LIGHTHOUSE") {
    const { address, lighthouseApiKey, hasLighthouseKey } = await getWalletInfo(token);
    if (!hasLighthouseKey) {
      throw new Error("Lighthouse API key is not configured on the server");
    }
    walletAddress = address;
    cid = await uploadEncryptedNotes(token, address, lighthouseApiKey, json);
    sizeBytes = new TextEncoder().encode(json).byteLength;
  } else {
    const key = await deriveLocalFallbackKey(userId);
    const ciphertext = await encryptForLocalSync(json, key);
    cid = `local-${Date.now()}`;
    walletAddress = "local";
    sizeBytes = ciphertext.length;
    await set(`ballpoint-local-backup-${userId}-${cid}`, ciphertext);
  }

  const record: SyncRecord = {
    cid,
    timestamp: Date.now(),
    noteCount: notes.length,
    walletAddress,
    encryptionMode: getSyncEncryptionMode(),
    sizeBytes,
  };

  const history = await loadSyncHistory(userId);
  history.unshift(record);
  await set(syncHistoryKey(userId), history.slice(0, 50));

  return record;
}

/**
 * Restore notes from a Lighthouse CID using Kavach key recovery (LIGHTHOUSE mode)
 * or from IndexedDB (LOCAL_WEBCRYPTO mode).
 * Returns the decrypted note snapshots.
 */
export async function restoreFromCid(
  token: string,
  userId: number,
  cid: string,
): Promise<NoteSnapshot[]> {
  if (getSyncEncryptionMode() === "LIGHTHOUSE") {
    const { address } = await getWalletInfo(token);
    const json = await decryptNotesFromCid(token, address, cid);
    return deserializeNotes(json);
  }

  const ciphertext = await get<string>(`ballpoint-local-backup-${userId}-${cid}`);
  if (!ciphertext) throw new Error(`No local backup found for CID: ${cid}`);
  const key = await deriveLocalFallbackKey(userId);
  const json = await decryptForLocalSync(ciphertext, key);
  return deserializeNotes(json);
}

/** Load the backup history for a user from IndexedDB. */
export async function loadSyncHistory(userId: number): Promise<SyncRecord[]> {
  return (await get<SyncRecord[]>(syncHistoryKey(userId))) ?? [];
}
