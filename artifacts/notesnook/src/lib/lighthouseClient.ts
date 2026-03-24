/**
 * Lighthouse cloud backup client — uses @lighthouse-web3/sdk and @lighthouse-web3/kavach.
 *
 * Kavach authentication flow (all ETH signing is server-side):
 *   1. Browser calls lighthouse.getAuthMessage(walletAddress) → gets Kavach challenge message
 *   2. Browser POSTs that message to our /sync/sign endpoint → gets ETH signature
 *   3. Browser passes walletAddress + signature to lighthouse.uploadEncrypted() or fetchEncryptionKey()
 *
 * Encryption:
 *   - lighthouse.uploadEncrypted() uses Kavach internally:
 *       kavach.generate() → BLS master key + key shards
 *       file encrypted locally with master key (PBKDF2 + AES-GCM via @lighthouse-web3/sdk)
 *       key shards saved to Kavach nodes (access-controlled by wallet address)
 *   - lighthouse.fetchEncryptionKey(cid, address, signature) recovers master key from Kavach nodes
 *   - lighthouse.decryptFile(cid, masterKey) downloads + decrypts from IPFS gateway
 *
 * The ETH private key never leaves the server.
 * The Lighthouse API key is passed directly to the SDK from the /sync/wallet response.
 */

import lighthouse from "@lighthouse-web3/sdk";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  lighthouseApiKey: string;
  hasLighthouseKey: boolean;
}

// ─── Server endpoints (wallet address + signing only) ─────────────────────────

/** GET /sync/wallet — returns ETH wallet address and Lighthouse API key. */
export async function getWalletInfo(token: string): Promise<WalletInfo> {
  const res = await fetch(`${API}/sync/wallet`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Failed to fetch wallet info: ${res.status}`);
  return res.json() as Promise<WalletInfo>;
}

/**
 * POST /sync/sign — signs a message with the server-side ETH private key.
 * Used to authenticate with Lighthouse Kavach by signing the challenge message
 * returned from lighthouse.getAuthMessage().
 */
export async function signMessage(
  token: string,
  message: string,
): Promise<{ signature: string; address: string }> {
  const res = await fetch(`${API}/sync/sign`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
  return res.json() as Promise<{ signature: string; address: string }>;
}

// ─── Kavach auth helper ────────────────────────────────────────────────────────

/**
 * Obtains a Kavach-signed authentication token by:
 *   1. Fetching the Kavach challenge message from Lighthouse
 *   2. Signing it via our server's /sync/sign endpoint (ETH private key server-side)
 *
 * Returns the raw ETH signature (0x...) which serves as the Kavach auth token
 * for single-wallet encrypted uploads and key recovery.
 */
export async function getKavachSignedToken(
  jwtToken: string,
  walletAddress: string,
): Promise<string> {
  const { data } = await lighthouse.getAuthMessage(walletAddress);
  const challengeMessage: string = data?.message;
  if (!challengeMessage) throw new Error("Failed to retrieve Kavach auth message from Lighthouse");
  const { signature } = await signMessage(jwtToken, challengeMessage);
  return signature;
}

// ─── Lighthouse SDK — upload & decrypt ────────────────────────────────────────

/**
 * Uploads an encrypted notes bundle to Lighthouse IPFS using Kavach encryption.
 *
 * Flow:
 *   1. Serialize notes as a JSON Blob → File object
 *   2. Get Kavach auth token (server signs Kavach challenge)
 *   3. lighthouse.uploadEncrypted([file], apiKey, address, signature)
 *      → SDK generates BLS master key + shards via kavach.generate()
 *      → Encrypts file locally with master key (PBKDF2 + AES-GCM)
 *      → Uploads ciphertext to Lighthouse IPFS
 *      → Saves key shards to Kavach nodes (access-controlled by walletAddress)
 *   Returns the IPFS CID of the encrypted backup.
 */
export async function uploadEncryptedNotes(
  jwtToken: string,
  walletAddress: string,
  apiKey: string,
  notesJson: string,
): Promise<string> {
  const blob = new Blob([notesJson], { type: "application/json" });
  const file = new File([blob], "ballpoint-backup.json", { type: "application/json" });

  const signedMessage = await getKavachSignedToken(jwtToken, walletAddress);

  const response = await lighthouse.uploadEncrypted(
    [file] as unknown as FileList,
    apiKey,
    walletAddress,
    signedMessage,
  );

  const uploads = Array.isArray(response?.data) ? response.data : [response?.data];
  const first = uploads[0] as { Hash?: string; Name?: string; Size?: string } | undefined;
  const cid = first?.Hash;
  if (!cid) throw new Error("Lighthouse did not return a CID after encrypted upload");
  return cid;
}

/**
 * Restores notes from a Lighthouse CID using Kavach key recovery.
 *
 * Flow:
 *   1. Get Kavach auth token (server signs Kavach challenge)
 *   2. lighthouse.fetchEncryptionKey(cid, address, signature)
 *      → Recovers key shards from Kavach nodes
 *      → Reconstructs BLS master key via kavach.recoverKey()
 *   3. lighthouse.decryptFile(cid, masterKey)
 *      → Downloads encrypted file from IPFS gateway
 *      → Decrypts using the recovered master key (PBKDF2 + AES-GCM)
 *   Returns parsed notes array.
 */
export async function decryptNotesFromCid(
  jwtToken: string,
  walletAddress: string,
  cid: string,
): Promise<string> {
  const signedMessage = await getKavachSignedToken(jwtToken, walletAddress);

  const keyResponse = await lighthouse.fetchEncryptionKey(cid, walletAddress, signedMessage);
  const masterKey: string | undefined = (keyResponse as { data?: { key?: string } })?.data?.key;
  if (!masterKey) throw new Error("Failed to recover Kavach encryption key for CID: " + cid);

  const decryptedBlob = await lighthouse.decryptFile(cid, masterKey);
  if (!decryptedBlob) throw new Error("Failed to decrypt file from Lighthouse for CID: " + cid);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read decrypted blob"));
    reader.readAsText(decryptedBlob as Blob);
  });
}

/** Ping the sync endpoints — checks if Lighthouse and ETH key are configured. */
export async function pingSync(
  token: string,
): Promise<{ ok: boolean; hasLighthouseKey: boolean; hasEthKey: boolean }> {
  const res = await fetch(`${API}/sync/ping`, { headers: authHeaders(token) });
  if (!res.ok) return { ok: false, hasLighthouseKey: false, hasEthKey: false };
  return res.json() as Promise<{ ok: boolean; hasLighthouseKey: boolean; hasEthKey: boolean }>;
}
