/**
 * Frontend client for the Ballpoint R2 cloud storage API.
 * Notes are AES-256-GCM encrypted client-side before upload; the server only sees ciphertext.
 */

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const API = `${BASE}/api`;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function apiFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface R2NoteInfo {
  key: string;
  lastModified: number;
  size: number;
}

export interface R2Status {
  configured: boolean;
  bucket: string;
}

// ── Status (public, no auth) ──────────────────────────────────────────────────

export async function getR2Status(): Promise<R2Status> {
  const resp = await fetch(`${API}/r2/status`);
  if (!resp.ok) return { configured: false, bucket: "" };
  return resp.json() as Promise<R2Status>;
}

// ── Vault key descriptor ──────────────────────────────────────────────────────

/** Fetch the key descriptor stored in R2 for this user. Returns null if not found. */
export async function getR2Key(token: string): Promise<string | null> {
  const resp = await apiFetch("/r2/key", token);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`R2 key fetch failed: ${resp.status}`);
  const data = await resp.json() as { content: string };
  return data.content;
}

/** Store a key descriptor in R2 for this user. */
export async function putR2Key(token: string, content: string): Promise<void> {
  const resp = await apiFetch("/r2/key", token, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) throw new Error(`R2 key save failed: ${resp.status}`);
}

// ── Notes ─────────────────────────────────────────────────────────────────────

/** List all note objects stored in R2 for this user. */
export async function listR2Notes(token: string): Promise<R2NoteInfo[]> {
  const resp = await apiFetch("/r2/notes", token);
  if (!resp.ok) throw new Error(`R2 list failed: ${resp.status}`);
  const data = await resp.json() as { notes: R2NoteInfo[] };
  return data.notes;
}

/** Fetch the encrypted content of a single note. */
export async function getR2Note(token: string, noteId: string): Promise<string> {
  const resp = await apiFetch(`/r2/notes/${encodeURIComponent(noteId)}`, token);
  if (!resp.ok) throw new Error(`R2 note fetch failed: ${resp.status}`);
  const data = await resp.json() as { content: string };
  return data.content;
}

/** Upload encrypted note content to R2. */
export async function putR2Note(token: string, noteId: string, encryptedContent: string): Promise<void> {
  const resp = await apiFetch(`/r2/notes/${encodeURIComponent(noteId)}`, token, {
    method: "PUT",
    body: JSON.stringify({ content: encryptedContent }),
  });
  if (!resp.ok) throw new Error(`R2 note save failed: ${resp.status}`);
}

/** Delete a note from R2. */
export async function deleteR2Note(token: string, noteId: string): Promise<void> {
  const resp = await apiFetch(`/r2/notes/${encodeURIComponent(noteId)}`, token, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`R2 note delete failed: ${resp.status}`);
}

// ── Metadata (GET/PUT /r2/metadata) ──────────────────────────────────────────

/** Fetch the metadata JSON from R2. Returns '{}' if not set. */
export async function getR2Metadata(token: string): Promise<string> {
  const resp = await apiFetch("/r2/metadata", token);
  if (!resp.ok) return "{}";
  const data = await resp.json() as { content: string };
  return data.content;
}

/** Save metadata JSON to R2. */
export async function putR2Metadata(token: string, metaJson: string): Promise<void> {
  const resp = await apiFetch("/r2/metadata", token, {
    method: "PUT",
    body: JSON.stringify({ content: metaJson }),
  });
  if (!resp.ok) throw new Error(`R2 metadata save failed: ${resp.status}`);
}

// ── Tasks (GET/PUT /r2/tasks) ─────────────────────────────────────────────────

/** Fetch the tasks JSON from R2. Returns '{}' if not set. */
export async function getR2Tasks(token: string): Promise<string> {
  const resp = await apiFetch("/r2/tasks", token);
  if (!resp.ok) return "{}";
  const data = await resp.json() as { content: string };
  return data.content;
}

/** Save tasks JSON to R2. */
export async function putR2Tasks(token: string, tasksJson: string): Promise<void> {
  const resp = await apiFetch("/r2/tasks", token, {
    method: "PUT",
    body: JSON.stringify({ content: tasksJson }),
  });
  if (!resp.ok) throw new Error(`R2 tasks save failed: ${resp.status}`);
}
