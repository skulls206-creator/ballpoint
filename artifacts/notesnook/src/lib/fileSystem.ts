import { get, set, del } from 'idb-keyval';

export const isFileSystemSupported = 'showDirectoryPicker' in window;

export interface NoteFile {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  title: string;
  lastModified: number;
}

// Vault is keyed per user so each account has its own folder
function vaultKey(userId: number) {
  return `notesnook-vault-${userId}`;
}

async function verifyPermission(fileHandle: FileSystemHandle, readWrite: boolean): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? 'readwrite' : 'read'
  };
  if ((await fileHandle.queryPermission(options)) === 'granted') return true;
  if ((await fileHandle.requestPermission(options)) === 'granted') return true;
  return false;
}

export async function openVault(userId: number): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await set(vaultKey(userId), dirHandle);
    return dirHandle;
  } catch {
    return null;
  }
}

export async function loadVault(userId: number): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dirHandle = await get<FileSystemDirectoryHandle>(vaultKey(userId));
    if (dirHandle) {
      const hasPermission = await verifyPermission(dirHandle, true);
      if (hasPermission) return dirHandle;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearVault(userId: number) {
  await del(vaultKey(userId));
}

export async function scanFolder(dirHandle: FileSystemDirectoryHandle): Promise<NoteFile[]> {
  const notes: NoteFile[] = [];
  try {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        const file = await entry.getFile();
        notes.push({
          id: entry.name,
          handle: entry,
          name: entry.name,
          title: entry.name.replace(/\.(md|txt)$/, ''),
          lastModified: file.lastModified,
        });
      }
    }
    return notes.sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
}

export async function readNote(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

export async function saveNote(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await (handle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createNote(dirHandle: FileSystemDirectoryHandle, title: string): Promise<FileSystemFileHandle> {
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-');
  return await dirHandle.getFileHandle(`${safeTitle}.md`, { create: true });
}

export async function renameNote(
  dirHandle: FileSystemDirectoryHandle,
  oldHandle: FileSystemFileHandle,
  newTitle: string
): Promise<FileSystemFileHandle> {
  const safeTitle = newTitle.replace(/[/\\?%*:|"<>]/g, '-');
  const newName = `${safeTitle}.md`;
  if (oldHandle.name === newName) return oldHandle;
  const content = await readNote(oldHandle);
  const newHandle = await createNote(dirHandle, safeTitle);
  await saveNote(newHandle, content);
  await dirHandle.removeEntry(oldHandle.name);
  return newHandle;
}

export async function deleteNote(dirHandle: FileSystemDirectoryHandle, name: string): Promise<void> {
  await dirHandle.removeEntry(name);
}
