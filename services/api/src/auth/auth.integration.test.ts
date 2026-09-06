/**
 * Integration test for the SEP-10 auth flow against a live Postgres.
 * Runs only when TEST_DATABASE_URL is set (see the local recipe in PROGRESS.md).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { JwtService } from '@nestjs/jwt';
import type { AuthConfig } from './auth.config.js';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let auth: any;
let authConfig: AuthConfig;

/** Client signs the server-built challenge tx and returns the signed XDR. */
function signChallenge(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, authConfig.networkPassphrase);
  tx.sign(kp);
  return tx.toXDR();
}

describe.skipIf(!DB)('AuthService SEP-10 (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { AuthService } = await import('./auth.service.js');
    authConfig = {
      serverKeypair: Keypair.random(),
      networkPassphrase: Networks.TESTNET,
      homeDomain: 'localhost',
      webAuthDomain: 'localhost',
    };
    const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
    auth = new AuthService(prisma, jwt, authConfig);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.authChallenge.deleteMany();
    await prisma.user.deleteMany();
  });

  it('challenge -> sign -> verify issues tokens and creates a BUYER user', async () => {
    const kp = Keypair.random();
    const { transaction } = await auth.createChallenge(kp.publicKey());
    const bundle = await auth.verifyChallenge(signChallenge(transaction, kp));

    expect(bundle.accessToken).toBeTruthy();
    expect(bundle.refreshToken).toBeTruthy();
    expect(bundle.roles).toContain('BUYER');

    const wallet = await prisma.wallet.findUnique({ where: { address: kp.publicKey() } });
    expect(wallet).not.toBeNull();
  });

  it('rejects an unsigned challenge (client did not sign)', async () => {
    const kp = Keypair.random();
    const { transaction } = await auth.createChallenge(kp.publicKey());
    await expect(auth.verifyChallenge(transaction)).rejects.toThrow();
  });

  it('rejects a challenge signed by a different key', async () => {
    const kp = Keypair.random();
    const other = Keypair.random();
    const { transaction } = await auth.createChallenge(kp.publicKey());
    await expect(auth.verifyChallenge(signChallenge(transaction, other))).rejects.toThrow();
  });

  it('rejects a reused challenge', async () => {
    const kp = Keypair.random();
    const { transaction } = await auth.createChallenge(kp.publicKey());
    const signed = signChallenge(transaction, kp);
    await auth.verifyChallenge(signed);
    await expect(auth.verifyChallenge(signed)).rejects.toThrow();
  });

  it('refresh rotates and revokes the old token; logout revokes', async () => {
    const kp = Keypair.random();
    const { transaction } = await auth.createChallenge(kp.publicKey());
    const b1 = await auth.verifyChallenge(signChallenge(transaction, kp));

    const b2 = await auth.refresh(b1.refreshToken);
    expect(b2.refreshToken).not.toBe(b1.refreshToken);
    await expect(auth.refresh(b1.refreshToken)).rejects.toThrow();

    await auth.logout(b2.refreshToken);
    await expect(auth.refresh(b2.refreshToken)).rejects.toThrow();
  });
});
