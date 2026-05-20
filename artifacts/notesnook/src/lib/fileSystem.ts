import { get, set, del } from 'idb-keyval';
import type { NoteStatus, ReminderStatus } from './metadata';
import { VAULT_KEY_FILENAME } from './crypto';

export const isFileSystemSupported = 'showDirectoryPicker' in window;

export interface NoteFile {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  title: string;
  lastModified: number;
  // Merged from metadata
  isFavorite: boolean;
  isPinned: boolean;
  locked: boolean;
  lockHash?: string;
  status: NoteStatus;
  tags: string[];
  hasReminder: boolean;
  reminderTime?: string;
  reminderStatus?: ReminderStatus;
}

function vaultKey(userId: number) {
  return `ballpoint-vault-${userId}`;
}

async function verifyPermission(handle: any, readWrite: boolean): Promise<boolean> {
  const opts: any = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function openVault(userId: number): Promise<FileSystemDirectoryHandle | null> {
  if (typeof (window as any).showDirectoryPicker !== 'function') {
    throw new Error('showDirectoryPicker not supported');
  }
  try {
    const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await set(vaultKey(userId), dir);
    return dir;
  } catch (e: any) {
    // User canceled the picker — not an error worth surfacing
    if (e?.name === 'AbortError') return null;
    // Re-throw everything else (SecurityError for iframe blocks, etc.)
    throw e;
  }
}

export async function loadVault(userId: number): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir = await get<FileSystemDirectoryHandle>(vaultKey(userId));
    if (dir && await verifyPermission(dir, true)) return dir;
    return null;
  } catch {
    return null;
  }
}

export async function saveVaultHandle(userId: number, handle: FileSystemDirectoryHandle) {
  await set(vaultKey(userId), handle);
}

export async function clearVault(userId: number) {
  await del(vaultKey(userId));
}

/** Scan a vault directory and return byte sizes keyed by filename. */
export async function scanFolderSizes(dirHandle: FileSystemDirectoryHandle): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  try {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        const file = await entry.getFile();
        sizes[entry.name] = file.size;
      }
    }
  } catch { /* best-effort */ }
  return sizes;
}

export async function scanFolder(dirHandle: FileSystemDirectoryHandle): Promise<Pick<NoteFile, 'id' | 'handle' | 'name' | 'title' | 'lastModified'>[]> {
  const results: Pick<NoteFile, 'id' | 'handle' | 'name' | 'title' | 'lastModified'>[] = [];
  try {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        const file = await entry.getFile();
        results.push({
          id: entry.name,
          handle: entry,
          name: entry.name,
          title: entry.name.replace(/\.(md|txt)$/, ''),
          lastModified: file.lastModified,
        });
      }
    }
    return results.sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
}

export async function readNote(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function saveNote(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await (handle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createNote(dirHandle: FileSystemDirectoryHandle, title: string): Promise<FileSystemFileHandle> {
  const safe = title.replace(/[/\\?%*:|"<>]/g, '-');
  return dirHandle.getFileHandle(`${safe}.md`, { create: true });
}

export async function renameNote(
  dirHandle: FileSystemDirectoryHandle,
  oldHandle: FileSystemFileHandle,
  newTitle: string
): Promise<FileSystemFileHandle> {
  const safe = newTitle.replace(/[/\\?%*:|"<>]/g, '-');
  const newName = `${safe}.md`;
  if (oldHandle.name === newName) return oldHandle;
  const content = await readNote(oldHandle);
  const newHandle = await createNote(dirHandle, safe);
  await saveNote(newHandle, content);
  await dirHandle.removeEntry(oldHandle.name);
  return newHandle;
}

export async function deleteNote(dirHandle: FileSystemDirectoryHandle, name: string): Promise<void> {
  await dirHandle.removeEntry(name);
}

// ─── Vault-root file helpers (for encryption key descriptor, etc.) ────────────

export async function readVaultFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name);
    return (await fh.getFile()).text();
  } catch {
    return null;
  }
}

export async function writeVaultFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await (fh as any).createWritable();
  await w.write(content);
  await w.close();
}

export async function deleteVaultFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  try { await dir.removeEntry(name); } catch { /* already gone */ }
}

// ─── Vault content cache (IndexedDB fallback when handle permission is lost) ────

function vaultCacheKey(userId: number) {
  return `ballpoint-vault-cache-${userId}`;
}

interface CachedNote {
  id: string;
  title: string;
  lastModified: number;
  content: string;
}

interface VaultCache {
  isVaultEncrypted: boolean;
  hasKeyFile: boolean;
  /** Raw content of the key file (encrypted key descriptor), or null. */
  keyFileContent: string | null;
  notes: CachedNote[];
}

/** Store the vault note contents in IndexedDB for cache recovery. */
export async function writeVaultCache(
  userId: number,
  cache: VaultCache
): Promise<void> {
  await set(vaultCacheKey(userId), cache);
}

/** Load the cached vault snapshot from IndexedDB (returns null when absent). */
export async function readVaultCache(
  userId: number
): Promise<VaultCache | null> {
  try {
    const data = await get<VaultCache>(vaultCacheKey(userId));
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Scan the vault directory and build a full cache entry (notes + encryption status).
 * Reads every note's content into memory for cache recovery.
 */
export async function buildVaultCache(
  dirHandle: FileSystemDirectoryHandle,
  userId: number,
): Promise<VaultCache> {
  const keyFile = await readVaultFile(dirHandle, VAULT_KEY_FILENAME);
  const notes: CachedNote[] = [];
  try {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        try {
          const file = await entry.getFile();
          const content = await file.text();
          notes.push({
            id: entry.name,
            title: entry.name.replace(/\.(md|txt)$/, ''),
            lastModified: file.lastModified,
            content,
          });
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* best-effort */ }
  return {
    isVaultEncrypted: keyFile !== null,
    hasKeyFile: keyFile !== null,
    keyFileContent: keyFile,
    notes,
  };
}

/** Remove the vault cache (call on disconnect / when clearing vault). */
export async function clearVaultCache(userId: number): Promise<void> {
  await del(vaultCacheKey(userId));
}
