import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** High-entropy URL-safe token (refresh tokens, API-key secrets). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short nonce for sign-in challenges. */
export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** SHA-256 hex. Used to store refresh tokens / API keys hashed at rest. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
