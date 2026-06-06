import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function loadKey(): Buffer {
  const raw = process.env.CPX_MASTER_KEY;
  if (!raw) {
    throw new Error('CPX_MASTER_KEY is not set');
  }
  // Accept either 64-char hex (32 bytes) or any string (hashed to 32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw).digest();
}

/** Encrypt plaintext -> base64(iv | tag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Reverse of encryptSecret. */
export function decryptSecret(payload: string): string {
  const key = loadKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Generate a new client-facing API key and its storage hash. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = 'cpx-' + randomBytes(24).toString('hex');
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

/** Deterministic hash used to look up keys without storing them in cleartext. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
