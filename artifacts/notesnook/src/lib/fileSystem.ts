import { get, set, del } from 'idb-keyval';
import type { NoteStatus, ReminderStatus } from './metadata';

export const isFileSystemSupported = 'showDirectoryPicker' in window;

export interface NoteFile {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  title: string;
  lastModified: number;
  // Merged from metadata
  isFavorite: boolean;
  status: NoteStatus;
  tags: string[];
  hasReminder: boolean;
  reminderTime?: string;
  reminderStatus?: ReminderStatus;
}

function vaultKey(userId: number) {
  return `ballpoint-vault-${userId}`;
}

async function verifyPermission(handle: FileSystemHandle, readWrite: boolean): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function openVault(userId: number): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
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
