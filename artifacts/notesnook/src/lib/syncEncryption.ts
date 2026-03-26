/**
 * Sync encryption utilities — LOCAL_WEBCRYPTO mode only.
 *
 * SYNC_ENCRYPTION_MODE determines which encryption backend is used:
 *
 *   "LIGHTHOUSE" (default, production):
 *       Uses @lighthouse-web3/sdk + @lighthouse-web3/kavach for true Kavach encryption.
 *       The browser calls lighthouse.uploadEncrypted() which internally:
 *         - Generates a BLS master key + key shards via kavach.generate()
 *         - Encrypts the file locally (PBKDF2 + AES-GCM)
 *         - Uploads the ciphertext to Lighthouse IPFS
 *         - Stores key shards on Kavach nodes (access-controlled by wallet address)
 *       Decryption is via lighthouse.fetchEncryptionKey() + lighthouse.decryptFile().
 *       The ETH private key stays server-side; the server only signs Kavach challenge messages.
 *       See lighthouseClient.ts and syncEngine.ts for the full Kavach flow.
 *
 *   "LOCAL_WEBCRYPTO" (dev/testing fallback):
 *       AES-256-GCM encryption with a key derived from a locally-stored random seed.
 *       NOT tied to the ETH wallet. Data is lost if the seed is cleared.
 *       Used only for offline testing when Lighthouse / ETH key are not configured.
 */

export type SyncEncryptionMode = "LIGHTHOUSE" | "LOCAL_WEBCRYPTO";

const SYNC_MODE_STORAGE_KEY = "ballpoint-dev-sync-mode";

/** Returns the current sync encryption mode. Defaults to LIGHTHOUSE in production. */
export function getSyncEncryptionMode(): SyncEncryptionMode {
  try {
    const stored = localStorage.getItem(SYNC_MODE_STORAGE_KEY);
    if (stored === "LOCAL_WEBCRYPTO") return "LOCAL_WEBCRYPTO";
  } catch { /* ignore */ }
  return "LIGHTHOUSE";
}

/** Override the sync encryption mode (LOCAL_WEBCRYPTO for dev/testing). Persisted in localStorage. */
export function setSyncEncryptionMode(mode: SyncEncryptionMode): void {
  try {
    if (mode === "LOCAL_WEBCRYPTO") {
      localStorage.setItem(SYNC_MODE_STORAGE_KEY, "LOCAL_WEBCRYPTO");
    } else {
      localStorage.removeItem(SYNC_MODE_STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

/**
 * Current sync encryption mode — use getSyncEncryptionMode() for runtime checks.
 * This constant is set at module load time; changes via setSyncEncryptionMode()
 * take effect after the next page load or after calling getSyncEncryptionMode().
 */
export const SYNC_ENCRYPTION_MODE: SyncEncryptionMode = getSyncEncryptionMode();

// ─── Note snapshot ───────────────────────────────────────────────────────────

export interface NoteSnapshot {
  id: string;
  title: string;
  content: string;
  lastModified: number;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an array of note snapshots to a JSON string.
 * Returns a string (not Uint8Array) because lighthouse.uploadEncrypted() accepts
 * File/Blob objects which wrap a string directly. The Kavach SDK handles encryption
 * of the file content internally.
 */
export function serializeNotes(notes: NoteSnapshot[]): string {
  return JSON.stringify(notes);
}

/**
 * Deserialize a JSON string back to note snapshots.
 * Called after lighthouse.decryptFile() returns the decrypted plaintext.
 */
export function deserializeNotes(json: string): NoteSnapshot[] {
  return JSON.parse(json) as NoteSnapshot[];
}

// ─── LOCAL_WEBCRYPTO: Key derivation & encryption ─────────────────────────────
// Used ONLY when SYNC_ENCRYPTION_MODE === "LOCAL_WEBCRYPTO".

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
  return crypto.subtle.importKey(
    "raw",
    seedBytes.buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a string with AES-256-GCM. Returns base64-encoded [12-byte IV || ciphertext]. */
export async function encryptForLocalSync(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data.buffer as ArrayBuffer);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return bytesToBase64(out);
}

/** Decrypt a base64-encoded blob produced by encryptForLocalSync. */
export async function decryptForLocalSync(b64: string, key: CryptoKey): Promise<string> {
  const data = base64ToBytes(b64);
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher.buffer as ArrayBuffer);
  return new TextDecoder().decode(plain);
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
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
