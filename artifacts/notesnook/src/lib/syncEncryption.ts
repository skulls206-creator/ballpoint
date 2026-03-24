/**
 * Sync encryption utilities for Ballpoint cloud backup.
 *
 * SYNC_ENCRYPTION_MODE:
 *   "LIGHTHOUSE" — AES-256-GCM key derived from ETH wallet signature (server-side key)
 *   "LOCAL_WEBCRYPTO" — AES-256-GCM key derived from a locally-stored random seed
 *                        (dev/testing only — not tied to ETH wallet)
 */

export type SyncEncryptionMode = "LIGHTHOUSE" | "LOCAL_WEBCRYPTO";

export const SYNC_ENCRYPTION_MODE: SyncEncryptionMode = "LIGHTHOUSE";

/** Deterministic message signed by server ETH key to derive sync encryption key */
export const SYNC_KEY_DERIVATION_MESSAGE = "ballpoint-sync-key-v1";

// ─── Note snapshot ───────────────────────────────────────────────────────────

export interface NoteSnapshot {
  id: string;
  title: string;
  content: string;
  lastModified: number;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** Serialize an array of note snapshots to a JSON Uint8Array */
export function serializeNotes(notes: NoteSnapshot[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(notes));
}

/** Deserialize a Uint8Array back to note snapshots */
export function deserializeNotes(buf: Uint8Array): NoteSnapshot[] {
  return JSON.parse(new TextDecoder().decode(buf)) as NoteSnapshot[];
}

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES-GCM key from a hex signature (deterministic, from ETH private key).
 * LIGHTHOUSE mode: signature comes from POST /sync/sign with SYNC_KEY_DERIVATION_MESSAGE.
 */
export async function deriveKeyFromSignature(signatureHex: string): Promise<CryptoKey> {
  const sigBytes = hexToBytes(signatureHex);
  const hashBuf = await crypto.subtle.digest("SHA-256", sigBytes.buffer as ArrayBuffer);
  return crypto.subtle.importKey("raw", hashBuf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * LOCAL_WEBCRYPTO fallback: derive key from a locally-stored random seed.
 * WARNING: dev/testing only — not tied to ETH wallet, loses data if seed is cleared.
 */
export async function deriveLocalFallbackKey(userId: number): Promise<CryptoKey> {
  const storeKey = `ballpoint-local-sync-seed-${userId}`;
  let seedHex = localStorage.getItem(storeKey);
  if (!seedHex) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    seedHex = bytesToHex(seed);
    localStorage.setItem(storeKey, seedHex);
  }
  const seedBytes = hexToBytes(seedHex);
  return crypto.subtle.importKey("raw", seedBytes.buffer as ArrayBuffer, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

/** Encrypt a Uint8Array with AES-256-GCM. Returns [12-byte IV || ciphertext]. */
export async function encryptForSync(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data.buffer as ArrayBuffer);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

/** Decrypt a Uint8Array produced by encryptForSync. */
export async function decryptFromSync(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher.buffer as ArrayBuffer);
  return new Uint8Array(plain);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
