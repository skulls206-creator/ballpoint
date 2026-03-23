import { get, set } from 'idb-keyval';
import { encryptContent, decryptContent, isEncrypted } from './crypto';

export type NoteVersion = {
  timestamp: number;
  content: string;
};

const LIMIT = 50;

function key(userId: number, noteId: string) {
  return `ballpoint-versions-${userId}-${noteId}`;
}

export async function saveVersion(
  userId: number,
  noteId: string,
  plainContent: string,
  encryptionKey: CryptoKey | null
): Promise<void> {
  const k = key(userId, noteId);
  const existing: NoteVersion[] = (await get(k)) ?? [];

  // Skip duplicate consecutive saves (compare against last stored blob)
  // We compare the raw stored string — encrypted blobs are always unique per save
  // so only skip if unencrypted and identical
  if (!encryptionKey && existing.length > 0 && existing[existing.length - 1].content === plainContent) return;

  const stored = encryptionKey
    ? await encryptContent(plainContent, encryptionKey)
    : plainContent;

  const next = [...existing, { timestamp: Date.now(), content: stored }];
  await set(k, next.length > LIMIT ? next.slice(next.length - LIMIT) : next);
}

export async function loadVersions(
  userId: number,
  noteId: string,
  encryptionKey: CryptoKey | null
): Promise<NoteVersion[]> {
  const raw: NoteVersion[] = (await get(key(userId, noteId))) ?? [];

  if (!encryptionKey) return raw;

  return Promise.all(
    raw.map(async v => ({
      ...v,
      content: isEncrypted(v.content)
        ? await decryptContent(v.content, encryptionKey)
        : v.content,
    }))
  );
}

export async function deleteVersions(
  userId: number,
  noteId: string
): Promise<void> {
  await set(key(userId, noteId), []);
}

/**
 * Re-encrypt all snapshots for a note when transitioning encryption state.
 * Pass `fromKey=null` to encrypt previously-plain snapshots.
 * Pass `toKey=null` to decrypt encrypted snapshots back to plain.
 */
export async function reencryptVersions(
  userId: number,
  noteId: string,
  fromKey: CryptoKey | null,
  toKey: CryptoKey | null
): Promise<void> {
  const k = key(userId, noteId);
  const raw: NoteVersion[] = (await get(k)) ?? [];
  if (raw.length === 0) return;

  const reencrypted = await Promise.all(
    raw.map(async v => {
      // Step 1: decrypt if the snapshot is currently encrypted
      const plain = (fromKey && isEncrypted(v.content))
        ? await decryptContent(v.content, fromKey)
        : v.content;
      // Step 2: re-encrypt with new key (or leave plain if no new key)
      const stored = toKey ? await encryptContent(plain, toKey) : plain;
      return { ...v, content: stored };
    })
  );

  await set(k, reencrypted);
}
