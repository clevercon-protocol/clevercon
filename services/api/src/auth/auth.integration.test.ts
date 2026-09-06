/**
 * Integration test for the real auth flow against a live Postgres.
 *
 * Runs only when TEST_DATABASE_URL is set (local dev), so CI without a database
 * skips it. To run locally:
 *   TEST_DATABASE_URL="postgresql://user@localhost/db?host=/var/run/postgresql&schema=clevercon_test" \
 *   npx vitest run services/api/src/auth/auth.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { JwtService } from '@nestjs/jwt';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let auth: any;

function sign(kp: Keypair, message: string): string {
  return kp.sign(Buffer.from(message, 'utf8')).toString('base64');
}

describe.skipIf(!DB)('AuthService (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { AuthService } = await import('./auth.service.js');
    const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
    auth = new AuthService(prisma, jwt);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.authChallenge.deleteMany();
    await prisma.user.deleteMany(); // cascades wallets, roles, sessions
  });

  it('challenge -> sign -> verify issues tokens and creates a BUYER user', async () => {
    const kp = Keypair.random();
    const { message, nonce } = await auth.createChallenge(kp.publicKey());
    const bundle = await auth.verifyChallenge(kp.publicKey(), nonce, sign(kp, message));

    expect(bundle.accessToken).toBeTruthy();
    expect(bundle.refreshToken).toBeTruthy();
    expect(bundle.roles).toContain('BUYER');

    const wallet = await prisma.wallet.findUnique({ where: { address: kp.publicKey() } });
    expect(wallet).not.toBeNull();
    const consumed = await prisma.authChallenge.findUnique({ where: { nonce } });
    expect(consumed?.consumedAt).not.toBeNull();
  });

  it('rejects a signature from a different key', async () => {
    const kp = Keypair.random();
    const other = Keypair.random();
    const { message, nonce } = await auth.createChallenge(kp.publicKey());
    await expect(
      auth.verifyChallenge(kp.publicKey(), nonce, sign(other, message)),
    ).rejects.toThrow();
  });

  it('rejects a reused challenge', async () => {
    const kp = Keypair.random();
    const { message, nonce } = await auth.createChallenge(kp.publicKey());
    await auth.verifyChallenge(kp.publicKey(), nonce, sign(kp, message));
    await expect(auth.verifyChallenge(kp.publicKey(), nonce, sign(kp, message))).rejects.toThrow();
  });

  it('refresh rotates the token and revokes the old one; logout revokes', async () => {
    const kp = Keypair.random();
    const { message, nonce } = await auth.createChallenge(kp.publicKey());
    const b1 = await auth.verifyChallenge(kp.publicKey(), nonce, sign(kp, message));

    const b2 = await auth.refresh(b1.refreshToken);
    expect(b2.refreshToken).not.toBe(b1.refreshToken);
    await expect(auth.refresh(b1.refreshToken)).rejects.toThrow(); // old one revoked

    await auth.logout(b2.refreshToken);
    await expect(auth.refresh(b2.refreshToken)).rejects.toThrow();
  });
});
