import { get, set } from 'idb-keyval';

export type NoteStatus = 'active' | 'archived' | 'trashed';
export type ReminderStatus = 'pending' | 'fired' | 'dismissed';
export type AccentColor = 'violet' | 'indigo' | 'blue' | 'cyan' | 'teal' | 'green' | 'amber' | 'orange' | 'rose' | 'pink';
export type RemoteStatus = 'neverSynced' | 'pendingUpload' | 'synced';

export interface NoteMetadata {
  isFavorite: boolean;
  status: NoteStatus;
  tags: string[];
  hasReminder: boolean;
  reminderTime?: string;
  reminderStatus?: ReminderStatus;
  trashedAt?: number;
  remoteStatus?: RemoteStatus;
}

export type MetadataMap = Record<string, NoteMetadata>;

export const DEFAULT_META: NoteMetadata = {
  isFavorite: false,
  status: 'active',
  tags: [],
  hasReminder: false,
};

function metaKey(userId: number) {
  return `ballpoint-meta-${userId}`;
}

export async function loadAllMetadata(userId: number): Promise<MetadataMap> {
  return (await get<MetadataMap>(metaKey(userId))) ?? {};
}

export async function saveAllMetadata(userId: number, meta: MetadataMap): Promise<void> {
  await set(metaKey(userId), meta);
}

export function getNoteMeta(meta: MetadataMap, noteId: string): NoteMetadata {
  return { ...DEFAULT_META, ...meta[noteId] };
}

export async function updateNoteMeta(
  userId: number,
  noteId: string,
  updates: Partial<NoteMetadata>,
  currentAll?: MetadataMap
): Promise<MetadataMap> {
  const all = currentAll ?? (await loadAllMetadata(userId));
  all[noteId] = { ...DEFAULT_META, ...all[noteId], ...updates };
  await saveAllMetadata(userId, all);
  return all;
}

export async function removeNoteMeta(userId: number, noteId: string): Promise<MetadataMap> {
  const all = await loadAllMetadata(userId);
  delete all[noteId];
  await saveAllMetadata(userId, all);
  return all;
}

export function getAllTags(meta: MetadataMap, notes: { id: string }[]): string[] {
  const tagSet = new Set<string>();
  for (const note of notes) {
    const m = meta[note.id];
    if (m?.status === 'active' && m.tags) {
      m.tags.forEach(t => tagSet.add(t));
    }
  }
  return Array.from(tagSet).sort();
}
