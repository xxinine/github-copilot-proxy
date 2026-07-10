// Mirror of @cpx/shared crypto so the proxy can decrypt tenant GitHub tokens
// and hash incoming cpx- API keys under Bun without pulling the native
// better-sqlite3 dependency. Must stay byte-compatible with the control-plane.
import { createDecipheriv, createHash } from "node:crypto"

const ALGO = "aes-256-gcm"

function loadKey(): Buffer {
  const raw = process.env.CPX_MASTER_KEY
  if (!raw) throw new Error("CPX_MASTER_KEY is not set")
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex")
  return createHash("sha256").update(raw).digest()
}

/** Reverse of @cpx/shared encryptSecret: base64(iv | tag | ciphertext). */
export function decryptSecret(payload: string): string {
  const key = loadKey()
  const buf = Buffer.from(payload, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}

/** Deterministic lookup hash for cpx- API keys (SHA-256 hex). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}
