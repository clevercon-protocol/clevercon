import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { generateProof } from './prover.js';
import { verifyBindingProofLocally } from '@clevercon/common';

const PAYEE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const AMOUNT = 5_000_000n;
const COMMITMENT = createHash('sha256').update('a-policy').digest('hex');

interface ProofRow {
  id: string;
  status: string;
  taskId: string | null;
  nullifier: string | null;
  proofRef: string | null;
  policy: { commitment: string } | null;
}

// Minimal Prisma double capturing the proof writes.
function mockPrisma(row: ProofRow | null) {
  const updates: { status?: string; proofRef?: string | null; nullifier?: string | null }[] = [];
  const prisma = {
    proof: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, string> }) => {
        updates.push(data);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    task: {
      findUnique: vi.fn(async () => (row?.taskId ? { buyerId: 'buyer-1' } : null)),
    },
  };
  return { prisma: prisma as unknown as Parameters<typeof generateProof>[0], updates };
}

function baseRow(overrides: Partial<ProofRow> = {}): ProofRow {
  return {
    id: 'pf1',
    status: 'REQUESTED',
    taskId: 'task-1',
    nullifier: null,
    proofRef: null,
    policy: { commitment: COMMITMENT },
    ...overrides,
  };
}

describe('generateProof', () => {
  it('builds a verifiable binding proof and marks the proof READY', async () => {
    const row = baseRow();
    const { prisma, updates } = mockPrisma(row);
    const result = await generateProof(prisma, 'pf1', PAYEE, AMOUNT);

    expect(result.status).toBe('ready');
    expect(result.buyerId).toBe('buyer-1');
    // Went GENERATING then READY.
    expect(updates.map((u) => u.status)).toEqual(['GENERATING', 'READY']);
    expect(row.status).toBe('READY');
    expect(row.nullifier).toMatch(/^[0-9a-f]{64}$/);

    // The stored proofRef is a valid binding proof for the release.
    const bytes = Buffer.from(row.proofRef as string, 'base64');
    const piHash = bytes.subarray(0, 32);
    expect(verifyBindingProofLocally(bytes, piHash)).toBe(true);
  });

  it('reuses a reserved nullifier when one is already set', async () => {
    const reserved = 'ab'.repeat(32);
    const row = baseRow({ nullifier: reserved });
    const { prisma } = mockPrisma(row);
    await generateProof(prisma, 'pf1', PAYEE, AMOUNT);
    expect(row.nullifier).toBe(reserved);
  });

  it('is idempotent: a terminal proof is not regenerated', async () => {
    const row = baseRow({ status: 'READY', proofRef: 'existing' });
    const { prisma, updates } = mockPrisma(row);
    const result = await generateProof(prisma, 'pf1', PAYEE, AMOUNT);
    expect(result.status).toBe('skipped');
    expect(updates).toHaveLength(0);
    expect(row.proofRef).toBe('existing');
  });

  it('fails the proof when it has no policy', async () => {
    const row = baseRow({ policy: null });
    const { prisma } = mockPrisma(row);
    const result = await generateProof(prisma, 'pf1', PAYEE, AMOUNT);
    expect(result.status).toBe('failed');
    expect(row.status).toBe('FAILED');
  });

  it('skips a missing proof', async () => {
    const { prisma } = mockPrisma(null);
    const result = await generateProof(prisma, 'nope', PAYEE, AMOUNT);
    expect(result.status).toBe('skipped');
  });
});
