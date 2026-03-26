import { encryptBytes, decryptBytes, isEncryptedBytes } from './crypto';

const ATTACH_ROOT = '.ballpoint-files';

export type AttachmentInfo = {
  name: string;
  size: number;
  mime: string;
  encrypted: boolean; // actual on-disk state, checked via magic header
};

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav',
    zip: 'application/zip', txt: 'text/plain',
    md: 'text/markdown', json: 'application/json',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function getDir(
  vault: FileSystemDirectoryHandle,
  noteId: string
): Promise<FileSystemDirectoryHandle> {
  const root = await vault.getDirectoryHandle(ATTACH_ROOT, { create: true });
  const folderName = noteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return root.getDirectoryHandle(folderName, { create: true });
}

/** Read just the first 16 bytes to check encryption magic header. */
async function peekBytes(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, 16);
  return new Uint8Array(await slice.arrayBuffer());
}

export async function writeAttachment(
  vault: FileSystemDirectoryHandle,
  noteId: string,
  filename: string,
  data: Uint8Array,
  key: CryptoKey | null
): Promise<void> {
  const dir = await getDir(vault, noteId);
  const bytes = key ? await encryptBytes(data, key) : data;
  const fh = await dir.getFileHandle(filename, { create: true });
  const writable = await (fh as any).createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function readAttachment(
  vault: FileSystemDirectoryHandle,
  noteId: string,
  filename: string,
  key: CryptoKey | null
): Promise<Uint8Array> {
  const dir = await getDir(vault, noteId);
  const fh = await dir.getFileHandle(filename);
  const file = await fh.getFile();
  const data = new Uint8Array(await file.arrayBuffer());
  if (key && isEncryptedBytes(data)) {
    return decryptBytes(data, key);
  }
  return data;
}

export async function listAttachments(
  vault: FileSystemDirectoryHandle,
  noteId: string
): Promise<AttachmentInfo[]> {
  try {
    const dir = await getDir(vault, noteId);
    const infos: AttachmentInfo[] = [];
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        const header = await peekBytes(file);
        infos.push({
          name,
          size: file.size,
          mime: mimeFromName(name),
          encrypted: isEncryptedBytes(header),
        });
      }
    }
    return infos.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function deleteAttachment(
  vault: FileSystemDirectoryHandle,
  noteId: string,
  filename: string
): Promise<void> {
  const dir = await getDir(vault, noteId);
  await dir.removeEntry(filename);
}

/**
 * Migrate all attachments for a note when encryption state changes.
 * fromKey=null  → files are currently plain, encrypt with toKey.
 * toKey=null    → files are currently encrypted, decrypt with fromKey.
 *
 * Re-fetches each file handle from the directory (not from entries())
 * so the handle is guaranteed to have write permission.
 */
export async function migrateNoteAttachments(
  vault: FileSystemDirectoryHandle,
  noteId: string,
  fromKey: CryptoKey | null,
  toKey: CryptoKey | null
): Promise<void> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await getDir(vault, noteId);
  } catch { return; } // folder doesn't exist — nothing to migrate

  // Collect names first so we can re-fetch handles with write access
  const names: string[] = [];
  try {
    for await (const [name, handle] of (dir as any).entries()) {
      if ((handle as FileSystemHandle).kind === 'file') names.push(name);
    }
  } catch { return; }

  for (const name of names) {
    try {
      // Re-fetch from parent directory — guaranteed read+write
      const fh = await dir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      const alreadyEncrypted = isEncryptedBytes(data);

      let finalBytes: Uint8Array;
      if (toKey && !alreadyEncrypted) {
        finalBytes = await encryptBytes(data, toKey);
      } else if (!toKey && alreadyEncrypted && fromKey) {
        finalBytes = await decryptBytes(data, fromKey);
      } else {
        continue; // already in the right state
      }

      const writable = await (fh as any).createWritable();
      await writable.write(finalBytes);
      await writable.close();
    } catch { /* skip individual file errors */ }
  }
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
