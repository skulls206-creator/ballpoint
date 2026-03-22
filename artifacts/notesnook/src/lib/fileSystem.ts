import { get, set, del } from 'idb-keyval';

export const isFileSystemSupported = 'showDirectoryPicker' in window;

export interface NoteFile {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  title: string;
  lastModified: number;
}

const VAULT_KEY = 'notesnook-vault-handle';

async function verifyPermission(fileHandle: FileSystemHandle, readWrite: boolean): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = { 
    mode: readWrite ? 'readwrite' : 'read' 
  };
  
  // Check if we already have permission
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  
  // Request permission
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  
  return false;
}

export async function openVault(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    await set(VAULT_KEY, dirHandle);
    return dirHandle;
  } catch (error) {
    console.error("Failed to open vault:", error);
    return null;
  }
}

export async function loadVault(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dirHandle = await get<FileSystemDirectoryHandle>(VAULT_KEY);
    if (dirHandle) {
      const hasPermission = await verifyPermission(dirHandle, true);
      if (hasPermission) return dirHandle;
    }
    return null;
  } catch (error) {
    console.error("Failed to load vault:", error);
    return null;
  }
}

export async function clearVault() {
  await del(VAULT_KEY);
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
  } catch (error) {
    console.error("Failed to scan folder:", error);
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
  // Replace invalid characters for file names
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-');
  const fileName = `${safeTitle}.md`;
  return await dirHandle.getFileHandle(fileName, { create: true });
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
