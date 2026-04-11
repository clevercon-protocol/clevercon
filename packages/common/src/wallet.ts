import { Keypair } from '@stellar/stellar-sdk';

export function loadKeypair(secretKeyEnvVar: string): Keypair {
  const secret = process.env[secretKeyEnvVar];
  if (!secret) {
    throw new Error(`Missing environment variable: ${secretKeyEnvVar}`);
  }
  return Keypair.fromSecret(secret);
}

export function getPublicKey(secretKeyEnvVar: string): string {
  return loadKeypair(secretKeyEnvVar).publicKey();
}

export function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecret(secret);
}
