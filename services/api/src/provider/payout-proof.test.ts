import { describe, it, expect, beforeAll } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { issuePayoutChallenge, verifyPayoutOwnership } from './payout-proof.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

describe('payout ownership proof', () => {
  it('accepts a challenge signed by the payout key', () => {
    const kp = Keypair.random();
    const challenge = issuePayoutChallenge('user-1');
    const signature = kp.sign(Buffer.from(challenge)).toString('base64');
    expect(verifyPayoutOwnership(kp.publicKey(), { challenge, signature }, 'user-1').ok).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const kp = Keypair.random();
    const other = Keypair.random();
    const challenge = issuePayoutChallenge('user-1');
    const signature = other.sign(Buffer.from(challenge)).toString('base64');
    const r = verifyPayoutOwnership(kp.publicKey(), { challenge, signature }, 'user-1');
    expect(r.ok).toBe(false);
  });

  it('rejects a tampered challenge and one issued to another user', () => {
    const kp = Keypair.random();
    const challenge = issuePayoutChallenge('user-1');
    const signature = kp.sign(Buffer.from(challenge)).toString('base64');
    // Tamper: flip the payload.
    const tampered = 'x' + challenge.slice(1);
    expect(
      verifyPayoutOwnership(kp.publicKey(), { challenge: tampered, signature }, 'user-1').ok,
    ).toBe(false);
    // Wrong user: genuine challenge, but bound to user-1, verified against user-2.
    expect(verifyPayoutOwnership(kp.publicKey(), { challenge, signature }, 'user-2').ok).toBe(
      false,
    );
  });
});
