/**
 * r2Queue.ts — IndexedDB-backed offline sync queue for Cloudflare R2 operations.
 *
 * Notes and metadata changes are enqueued here when the user is offline or in
 * local+r2 mode (local FS is primary, R2 is the background sync layer).
 * The queue is drained by flushR2Queue(), called automatically on app startup
 * and periodically, or manually via "Sync Now" in Settings.
 */

import { get, set } from "idb-keyval";
import {
  putR2Note,
  deleteR2Note,
  putR2Key,
  putR2Metadata,
  putR2Tasks,
} from "./r2Client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type R2QueueOp =
  | "put-note"
  | "delete-note"
  | "put-key"
  | "put-metadata"
  | "put-tasks";

export interface R2QueueEntry {
  id: string;
  op: R2QueueOp;
  /** Note filename for note ops; ignored for metadata/tasks/key. */
  key: string;
  /** Encrypted content for put ops; undefined for deletes. */
  content?: string;
  createdAt: number;
  retries: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

// ── IDB helpers ───────────────────────────────────────────────────────────────

function queueKey(userId: number): string {
  return `ballpoint-r2-queue-${userId}`;
}

async function loadQueue(userId: number): Promise<R2QueueEntry[]> {
  return (await get<R2QueueEntry[]>(queueKey(userId))) ?? [];
}

async function saveQueue(userId: number, queue: R2QueueEntry[]): Promise<void> {
  await set(queueKey(userId), queue);
  notifyListeners(queue.length);
}

// ── Pending count pub/sub ─────────────────────────────────────────────────────

const listeners = new Set<(count: number) => void>();
let _pendingCount = 0;

function notifyListeners(count: number): void {
  _pendingCount = count;
  for (const cb of listeners) cb(count);
}

/** Subscribe to pending count changes. Returns an unsubscribe function. */
export function onR2PendingCountChange(cb: (count: number) => void): () => void {
  listeners.add(cb);
  cb(_pendingCount);
  return () => { listeners.delete(cb); };
}

/** Current in-memory pending count (may lag by one tick after enqueue). */
export function getR2PendingCount(): number {
  return _pendingCount;
}

/** Refresh the in-memory count from IDB (call on app init). */
export async function initR2Queue(userId: number): Promise<void> {
  const queue = await loadQueue(userId);
  notifyListeners(queue.length);
}

/** Remove all queued operations (call on vault disconnect). */
export async function clearR2Queue(userId: number): Promise<void> {
  await saveQueue(userId, []);
}

// ── Queue management ──────────────────────────────────────────────────────────

/**
 * Add or update an R2 operation in the queue.
 *
 * Idempotent ops (put-note, put-key, put-metadata, put-tasks) replace any
 * existing entry with the same op+key so the queue never accumulates stale
 * intermediate writes — only the latest value is sent.
 *
 * delete-note is always appended because a delete must not be deduped with
 * an earlier put for the same key.
 */
export async function enqueueR2Op(
  userId: number,
  entry: Omit<R2QueueEntry, "id" | "createdAt" | "retries">
): Promise<void> {
  const queue = await loadQueue(userId);

  if (entry.op !== "delete-note") {
    const idx = queue.findIndex(e => e.op === entry.op && e.key === entry.key);
    if (idx >= 0) {
      queue[idx] = { ...queue[idx], content: entry.content, retries: 0 };
      await saveQueue(userId, queue);
      return;
    }
  }

  queue.push({
    id: `${entry.op}:${entry.key}:${Date.now()}`,
    createdAt: Date.now(),
    retries: 0,
    ...entry,
  });
  await saveQueue(userId, queue);
}

// ── Queue flush ───────────────────────────────────────────────────────────────

export interface FlushResult {
  flushed: number;
  failed: number;
  remaining: number;
}

/**
 * Drain the queue by sending all pending operations to R2.
 * Successfully sent entries are removed; entries that fail up to MAX_RETRIES
 * are kept in the queue for the next flush attempt.
 */
export async function flushR2Queue(
  userId: number,
  token: string
): Promise<FlushResult> {
  const queue = await loadQueue(userId);
  if (queue.length === 0) return { flushed: 0, failed: 0, remaining: 0 };

  const remaining: R2QueueEntry[] = [];
  let flushed = 0;
  let failed = 0;

  for (const entry of queue) {
    try {
      switch (entry.op) {
        case "put-note":
          await putR2Note(token, entry.key, entry.content!);
          break;
        case "delete-note":
          await deleteR2Note(token, entry.key);
          break;
        case "put-key":
          await putR2Key(token, entry.content!);
          break;
        case "put-metadata":
          await putR2Metadata(token, entry.content!);
          break;
        case "put-tasks":
          await putR2Tasks(token, entry.content!);
          break;
      }
      flushed++;
    } catch {
      // Always keep the entry in the queue — never drop data.
      // Increment retries so callers can surface "stuck" ops to the user,
      // but guaranteed eventual delivery once connectivity returns.
      remaining.push({ ...entry, retries: entry.retries + 1 });
      if (entry.retries >= MAX_RETRIES) {
        // Count as "failed this attempt" for status reporting; stays in queue.
        failed++;
      }
    }
  }

  await saveQueue(userId, remaining);
  return { flushed, failed, remaining: remaining.length };
}
