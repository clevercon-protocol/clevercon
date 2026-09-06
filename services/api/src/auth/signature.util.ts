import { Keypair, StrKey } from '@stellar/stellar-sdk';

/** True if `address` is a valid Stellar ed25519 public key (G...). */
export function isValidStellarAddress(address: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * The human-readable message a wallet signs to prove ownership. Not a
 * transaction; costs nothing. (SEP-10-style challenge, simplified.)
 */
export function buildChallengeMessage(address: string, nonce: string): string {
  return [
    'CleverCon authentication',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    '',
    'Sign this message to prove you own this wallet. It is not a transaction and costs nothing.',
  ].join('\n');
}

/** Verify `signatureB64` is `address`'s signature over `message`. */
export function verifyStellarSignature(
  address: string,
  message: string,
  signatureB64: string,
): boolean {
  try {
    if (!isValidStellarAddress(address)) return false;
    const kp = Keypair.fromPublicKey(address);
    return kp.verify(Buffer.from(message, 'utf8'), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
