import { get, set } from 'idb-keyval';

export type NoteVersion = {
  timestamp: number;
  content: string;
  label?: string;
};

const LIMIT = 50;

function key(userId: number, noteId: string) {
  return `ballpoint-versions-${userId}-${noteId}`;
}

export async function saveVersion(
  userId: number,
  noteId: string,
  content: string
): Promise<void> {
  const k = key(userId, noteId);
  const existing: NoteVersion[] = (await get(k)) ?? [];
  // Skip duplicate consecutive saves
  if (existing.length > 0 && existing[existing.length - 1].content === content) return;
  const next = [...existing, { timestamp: Date.now(), content }];
  await set(k, next.length > LIMIT ? next.slice(next.length - LIMIT) : next);
}

export async function loadVersions(
  userId: number,
  noteId: string
): Promise<NoteVersion[]> {
  return (await get(key(userId, noteId))) ?? [];
}

export async function deleteVersions(
  userId: number,
  noteId: string
): Promise<void> {
  await set(key(userId, noteId), []);
}
