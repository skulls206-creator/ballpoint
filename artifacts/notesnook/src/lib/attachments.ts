import { encryptBytes, decryptBytes, isEncryptedBytes } from './crypto';

const ATTACH_ROOT = '.ballpoint-files';

export type AttachmentInfo = {
  name: string;
  size: number;
  mime: string;
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
  // Use a safe folder name derived from the noteId (strip illegal chars)
  const folderName = noteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return root.getDirectoryHandle(folderName, { create: true });
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
        infos.push({ name, size: file.size, mime: mimeFromName(name) });
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

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
