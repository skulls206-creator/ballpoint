export const VAULT_KEY_FILENAME = '.ballpoint-key';

// ── Binary (file attachment) encryption ──────────────────────────────────────
// Format: [4 magic bytes][12 IV bytes][ciphertext]
const BINARY_MAGIC = new Uint8Array([0x00, 0x42, 0x50, 0x01]); // \x00BP\x01

export function isEncryptedBytes(data: Uint8Array): boolean {
  return data.length >= 16 &&
    data[0] === 0x00 && data[1] === 0x42 && data[2] === 0x50 && data[3] === 0x01;
}

export async function encryptBytes(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(4 + 12 + ciphertext.byteLength);
  out.set(BINARY_MAGIC, 0);
  out.set(iv, 4);
  out.set(new Uint8Array(ciphertext), 16);
  return out;
}

export async function decryptBytes(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(4, 16);
  const cipher = data.slice(16);
  const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Uint8Array(plain);
}
const ENC_HEADER = '<!-- BALLPOINT:ENC:v1 -->\n';

export function isEncrypted(content: string): boolean {
  return content.startsWith(ENC_HEADER);
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptContent(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return ENC_HEADER + btoa(String.fromCharCode(...combined));
}

export async function decryptContent(cipherStr: string, key: CryptoKey): Promise<string> {
  const b64 = cipherStr.slice(ENC_HEADER.length);
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(decrypted);
}

export async function createKeyFileContent(
  password: string
): Promise<{ key: CryptoKey; content: string }> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const verify = await encryptContent('ballpoint-verified', key);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return { key, content: JSON.stringify({ v: 1, salt: saltHex, verify }) };
}

export async function openKeyFile(
  fileContent: string,
  password: string
): Promise<CryptoKey | null> {
  try {
    const { salt: saltHex, verify } = JSON.parse(fileContent) as {
      v: number; salt: string; verify: string;
    };
    const salt = new Uint8Array(
      saltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))
    );
    const key = await deriveKey(password, salt);
    const dec = await decryptContent(verify, key);
    if (dec !== 'ballpoint-verified') return null;
    return key;
  } catch {
    return null;
  }
}
