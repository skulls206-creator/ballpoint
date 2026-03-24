/**
 * Lighthouse cloud backup client.
 * All calls go through our API server (/sync/*) — the Lighthouse API key
 * and ETH private key never touch the browser.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── Wallet / Signing ─────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  lighthouseApiKey: string;
  hasLighthouseKey: boolean;
}

export async function getWalletInfo(token: string): Promise<WalletInfo> {
  const res = await fetch(`${API}/sync/wallet`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Failed to fetch wallet info: ${res.status}`);
  return res.json() as Promise<WalletInfo>;
}

export async function signMessage(token: string, message: string): Promise<{ signature: string; address: string }> {
  const res = await fetch(`${API}/sync/sign`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
  return res.json() as Promise<{ signature: string; address: string }>;
}

// ─── Upload / Download ────────────────────────────────────────────────────────

/** Upload an encrypted Uint8Array to Lighthouse. Returns the CID. */
export async function uploadEncryptedBlob(token: string, data: Uint8Array, filename = "backup.bin"): Promise<string> {
  const b64 = btoa(String.fromCharCode(...data));
  const res = await fetch(`${API}/sync/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ data: b64, filename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(`Upload failed: ${err.error}`);
  }
  const { cid } = await res.json() as { cid: string };
  return cid;
}

/** Download an encrypted blob from IPFS via the server proxy. Returns Uint8Array. */
export async function downloadEncryptedBlob(token: string, cid: string): Promise<Uint8Array> {
  const res = await fetch(`${API}/sync/download/${encodeURIComponent(cid)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(`Download failed: ${err.error}`);
  }
  const { data } = await res.json() as { data: string };
  return Uint8Array.from(atob(data), c => c.charCodeAt(0));
}

/** Ping the sync endpoints — checks if Lighthouse and ETH key are configured. */
export async function pingSync(token: string): Promise<{ ok: boolean; hasLighthouseKey: boolean; hasEthKey: boolean }> {
  const res = await fetch(`${API}/sync/ping`, { headers: authHeaders(token) });
  if (!res.ok) return { ok: false, hasLighthouseKey: false, hasEthKey: false };
  return res.json() as Promise<{ ok: boolean; hasLighthouseKey: boolean; hasEthKey: boolean }>;
}
