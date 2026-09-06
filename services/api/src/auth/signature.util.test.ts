import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  isValidStellarAddress,
  buildChallengeMessage,
  verifyStellarSignature,
} from './signature.util';

describe('signature.util', () => {
  it('validates Stellar addresses', () => {
    const kp = Keypair.random();
    expect(isValidStellarAddress(kp.publicKey())).toBe(true);
    expect(isValidStellarAddress('not-an-address')).toBe(false);
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('verifies a genuine signature over the challenge message', () => {
    const kp = Keypair.random();
    const message = buildChallengeMessage(kp.publicKey(), 'nonce123');
    const sig = kp.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyStellarSignature(kp.publicKey(), message, sig)).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const kp = Keypair.random();
    const other = Keypair.random();
    const message = buildChallengeMessage(kp.publicKey(), 'nonce123');
    const sig = other.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyStellarSignature(kp.publicKey(), message, sig)).toBe(false);
  });

  it('rejects a tampered message', () => {
    const kp = Keypair.random();
    const message = buildChallengeMessage(kp.publicKey(), 'nonce123');
    const sig = kp.sign(Buffer.from(message, 'utf8')).toString('base64');
    expect(verifyStellarSignature(kp.publicKey(), message + 'tampered', sig)).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(verifyStellarSignature('bad', 'msg', 'notbase64')).toBe(false);
  });
});
