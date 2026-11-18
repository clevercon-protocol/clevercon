/**
 * Symmetric encryption for secrets stored at rest (e.g. per-user delegate keys).
 *
 * AES-256-GCM with a master key from DELEGATE_ENCRYPTION_KEY (32 bytes, hex or
 * base64). This is the dev/testnet at-rest protection; production should source
 * the key from a KMS and ideally encrypt/decrypt inside it. Lives in @clevercon/db
 * so both the API (built) and the worker (tsx) share one implementation.
 *
 * Ciphertext format: base64(iv) : base64(authTag) : base64(ciphertext).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function masterKey(): Buffer {
  const raw = process.env.DELEGATE_ENCRYPTION_KEY ?? '';
  if (!raw) throw new Error('DELEGATE_ENCRYPTION_KEY is not set');
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('DELEGATE_ENCRYPTION_KEY must be 32 bytes (hex or base64)');
  }
  return key;
}

/** Whether an encryption key is configured (so callers can gate provisioning). */
export function secretCryptoAvailable(): boolean {
  const raw = process.env.DELEGATE_ENCRYPTION_KEY ?? '';
  return raw.length > 0;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
