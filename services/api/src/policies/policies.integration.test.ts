/**
 * Integration test for the policies data layer against live Postgres.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { verifyBindingProofLocally, buildBindingProof } from '@clevercon/common';

const DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let policies: any;

describe.skipIf(!DB)('Policies (integration, real Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    const { PrismaClient } = await import('@clevercon/db');
    prisma = new PrismaClient();
    await prisma.$connect();
    const { PoliciesService } = await import('./policies.service.js');
    policies = new PoliciesService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    // FK-safe reset (see the other integration tests): clear dependents first.
    await prisma.payment.deleteMany();
    await prisma.proof.deleteMany();
    await prisma.task.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.vaultAccount.deleteMany();
    await prisma.service.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a transparent policy with a deterministic commitment', async () => {
    const user = await prisma.user.create({ data: {} });
    const a = await policies.create(user.id, {
      isPrivate: false,
      rules: { perPaymentCeilingUsdc: 0.5, rollingCapUsdc: 20, rollingWindowSecs: 86400 },
    });
    expect(a.isPrivate).toBe(false);
    expect(a.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(a.rules.perPaymentCeilingUsdc).toBe(0.5);

    // Same rules -> same commitment (deterministic canonical encoding).
    const user2 = await prisma.user.create({ data: {} });
    const b = await policies.create(user2.id, {
      isPrivate: false,
      rules: { rollingCapUsdc: 20, perPaymentCeilingUsdc: 0.5, rollingWindowSecs: 86400 },
    });
    expect(b.commitment).toBe(a.commitment);
  });

  it('rejects an empty policy', async () => {
    const user = await prisma.user.create({ data: {} });
    await expect(policies.create(user.id, { isPrivate: false, rules: {} })).rejects.toThrow();
  });

  it('creates a private policy: commitment stored, plaintext rule NOT stored', async () => {
    const user = await prisma.user.create({ data: {} });
    const p = await policies.create(user.id, {
      isPrivate: true,
      rules: { perPaymentCeilingUsdc: 1, rollingCapUsdc: 10, rollingWindowSecs: 3600 },
    });
    expect(p.isPrivate).toBe(true);
    expect(p.commitment).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext rule is discarded server-side for private policies.
    expect(p.rules).toBeNull();
    const row = await prisma.policy.findUnique({ where: { id: p.id } });
    expect(row.ruleSummary).toBeNull();
  });

  it('requestProof reserves a nullifier + REQUESTED proof; getProof is owner-scoped', async () => {
    const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
    const me = await prisma.user.create({ data: {} });
    const other = await prisma.user.create({ data: {} });
    const policy = await policies.create(me.id, {
      isPrivate: true,
      rules: { perPaymentCeilingUsdc: 5 },
    });

    // No Redis in this test (queue is @Optional), so the row is created REQUESTED
    // but not processed; we drive it to READY here to exercise the full shape.
    const req = await policies.requestProof(me.id, policy.id, PAYEE, 2);
    expect(req.status).toBe('REQUESTED');

    const pending = await policies.getProof(me.id, req.proofId);
    expect(pending.status).toBe('REQUESTED');
    expect(pending.hasProof).toBe(false);
    expect(pending.nullifier).toMatch(/^[0-9a-f]{64}$/);

    // Another user cannot read it.
    await expect(policies.getProof(other.id, req.proofId)).rejects.toThrow();

    // A bad payee / unknown policy are rejected.
    await expect(policies.requestProof(me.id, policy.id, 'not-an-address', 1)).rejects.toThrow();
    await expect(policies.requestProof(me.id, 'nope', PAYEE, 1)).rejects.toThrow();

    // The reserved nullifier + policy commitment yield a verifiable binding proof
    // (this is exactly what the worker does for this row).
    const { proof, piHash } = buildBindingProof({
      commitment: policy.commitment,
      payeeAddress: PAYEE,
      amountStroops: 20_000_000n,
      nullifier: pending.nullifier,
    });
    expect(verifyBindingProofLocally(proof, piHash)).toBe(true);
  });

  it('lists a user policies, newest first, scoped to the user', async () => {
    const me = await prisma.user.create({ data: {} });
    const other = await prisma.user.create({ data: {} });
    await policies.create(me.id, { isPrivate: false, rules: { perPaymentCeilingUsdc: 1 } });
    await policies.create(other.id, { isPrivate: false, rules: { perPaymentCeilingUsdc: 2 } });
    const mine = await policies.list(me.id);
    expect(mine.total).toBe(1);
    expect(mine.items[0].rules.perPaymentCeilingUsdc).toBe(1);
  });
});
