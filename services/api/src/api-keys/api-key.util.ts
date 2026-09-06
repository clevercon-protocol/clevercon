import { randomBytes } from 'node:crypto';

const PREFIX_BYTES = 6;
const SECRET_BYTES = 24;

export interface GeneratedApiKey {
  /** Full key shown to the user exactly once: `cc_<prefix>.<secret>`. */
  key: string;
  /** Public lookup handle, stored in the clear. */
  prefix: string;
  /** Secret half; only its hash is stored. */
  secret: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(PREFIX_BYTES).toString('base64url');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { key: `cc_${prefix}.${secret}`, prefix, secret };
}

/** Split a raw key into its prefix + secret, or null if malformed. */
export function parseApiKey(raw: unknown): { prefix: string; secret: string } | null {
  if (typeof raw !== 'string' || !raw.startsWith('cc_')) return null;
  const rest = raw.slice(3);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  const prefix = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  if (!prefix || !secret) return null;
  return { prefix, secret };
}
