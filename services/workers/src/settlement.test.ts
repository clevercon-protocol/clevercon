import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { encryptSecret } from '@clevercon/db';
import { settleStep } from './settlement.js';

interface StepRow {
  id: string;
  index: number;
  status: string;
  taskId: string;
  estimatedCost: string;
  serviceId: string | null;
  service: { stellarAddress: string } | null;
  task: {
    buyerId: string;
    vaultTaskId: bigint | null;
    asset: string;
    policy: { commitment: string } | null;
  } | null;
}

function mockPrisma(
  step: StepRow | null,
  opts: { delegate?: boolean; existingPayment?: boolean } = {},
) {
  const { delegate = true, existingPayment = false } = opts;
  const created: unknown[] = [];
  const delegateRow = delegate
    ? {
        userId: step?.task?.buyerId,
        publicKey: 'GDEL',
        secretCipher: encryptSecret(Keypair.random().secret()),
      }
    : null;
  const prisma = {
    taskStep: { findUnique: vi.fn(async () => step) },
    agentDelegate: { findUnique: vi.fn(async () => delegateRow) },
    payment: {
      findFirst: vi.fn(async () => (existingPayment ? { id: 'p-existing' } : null)),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        created.push(data);
        return data;
      }),
    },
  };
  return { prisma: prisma as unknown as Parameters<typeof settleStep>[0], created };
}

function baseStep(over: Partial<StepRow> = {}): StepRow {
  return {
    id: 's1',
    index: 0,
    status: 'RELEASED',
    taskId: 't1',
    estimatedCost: '0.05',
    serviceId: 'svc1',
    service: { stellarAddress: 'GPAYEE' },
    task: {
      buyerId: 'buyer1',
      vaultTaskId: 7n,
      asset: 'USDC',
      policy: { commitment: 'ab'.repeat(32) },
    },
    ...over,
  };
}

describe('settleStep guards', () => {
  beforeEach(() => {
    process.env.DELEGATE_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
    process.env.AGENT_VAULT_CONTRACT_ID = 'CVAULT';
    process.env.USDC_SAC = 'CUSDC';
  });
  afterEach(() => {
    delete process.env.DELEGATE_ENCRYPTION_KEY;
    delete process.env.AGENT_VAULT_CONTRACT_ID;
    delete process.env.USDC_SAC;
  });

  it('skips a missing step', async () => {
    const { prisma } = mockPrisma(null);
    expect((await settleStep(prisma, 'nope')).status).toBe('skipped');
  });

  it('skips a step that is not released', async () => {
    const { prisma } = mockPrisma(baseStep({ status: 'PENDING' }));
    expect((await settleStep(prisma, 's1')).reason).toBe('step not released');
  });

  it('skips a task not locked on-chain', async () => {
    const { prisma } = mockPrisma(
      baseStep({
        task: {
          buyerId: 'b',
          vaultTaskId: null,
          asset: 'USDC',
          policy: { commitment: 'ab'.repeat(32) },
        },
      }),
    );
    expect((await settleStep(prisma, 's1')).reason).toBe('task not locked on-chain');
  });

  it('skips a task with no policy commitment', async () => {
    const { prisma } = mockPrisma(
      baseStep({ task: { buyerId: 'b', vaultTaskId: 7n, asset: 'USDC', policy: null } }),
    );
    expect((await settleStep(prisma, 's1')).reason).toBe('task has no policy commitment');
  });

  it('skips a step with no payee', async () => {
    const { prisma } = mockPrisma(baseStep({ service: null }));
    expect((await settleStep(prisma, 's1')).reason).toBe('step has no payee');
  });

  it('skips when settlement is not configured', async () => {
    const { prisma } = mockPrisma(baseStep(), { delegate: false }); // build mock before unsetting key
    delete process.env.DELEGATE_ENCRYPTION_KEY;
    expect((await settleStep(prisma, 's1')).reason).toBe('settlement not configured');
  });

  it('skips when the buyer has no delegate', async () => {
    const { prisma } = mockPrisma(baseStep(), { delegate: false });
    expect((await settleStep(prisma, 's1')).reason).toBe('buyer has no delegate');
  });

  it('is idempotent: skips a step already settled', async () => {
    const { prisma, created } = mockPrisma(baseStep(), { existingPayment: true });
    const r = await settleStep(prisma, 's1');
    expect(r).toMatchObject({ status: 'skipped', reason: 'already settled' });
    expect(created).toHaveLength(0);
  });
});
