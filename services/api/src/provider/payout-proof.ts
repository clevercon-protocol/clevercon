import { createHmac } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Payout-address ownership proof. A provider must not be able to list a service
 * that pays an address they do not control. We issue a short-lived, HMAC-signed
 * challenge bound to the user; the provider signs it with the payout key, and we
 * verify both the challenge (genuine, unexpired, theirs) and the Stellar signature.
 * See .local/MARKETPLACE-ECONOMY-SPEC.md section 12.
 */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required for payout challenges');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Issue a short-lived challenge bound to the user (sign its full string to prove ownership). */
export function issuePayoutChallenge(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: userId,
      n: Math.random().toString(36).slice(2),
      exp: Date.now() + CHALLENGE_TTL_MS,
    }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a provider controls `address`: the challenge must be a genuine, unexpired
 * token we issued to this user, and `signature` must be that address's key signing
 * the whole challenge string. (Replay within the short TTL is possible; full
 * single-use would need a nonce store, a later hardening.)
 */
export function verifyPayoutOwnership(
  address: string,
  proof: { challenge: string; signature: string },
  userId: string,
): { ok: boolean; reason?: string } {
  const [payload, sig] = proof.challenge.split('.');
  if (!payload || !sig) return { ok: false, reason: 'malformed challenge' };
  if (sign(payload) !== sig) return { ok: false, reason: 'challenge not issued by this server' };
  let decoded: { u?: string; exp?: number };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'challenge payload unreadable' };
  }
  if (decoded.u !== userId) return { ok: false, reason: 'challenge issued to another user' };
  if (!decoded.exp || decoded.exp < Date.now()) return { ok: false, reason: 'challenge expired' };
  try {
    const ok = Keypair.fromPublicKey(address).verify(
      Buffer.from(proof.challenge),
      Buffer.from(proof.signature, 'base64'),
    );
    return ok ? { ok: true } : { ok: false, reason: 'signature does not match the payout address' };
  } catch (e) {
    return { ok: false, reason: `signature check failed: ${String(e)}` };
  }
}
