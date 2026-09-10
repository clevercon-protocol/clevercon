import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function mockPrisma(step: StepRow | null, existingPayment = false) {
  const created: unknown[] = [];
  const prisma = {
    taskStep: { findUnique: vi.fn(async () => step) },
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
    // settlement is configured in most guard tests so we exercise the later checks
    process.env.SERVER_ORCHESTRATOR_KEY = 'SXXX';
    process.env.AGENT_VAULT_CONTRACT_ID = 'CVAULT';
    process.env.USDC_SAC = 'CUSDC';
  });
  afterEach(() => {
    delete process.env.SERVER_ORCHESTRATOR_KEY;
    delete process.env.AGENT_VAULT_CONTRACT_ID;
    delete process.env.USDC_SAC;
  });

  it('skips a missing step', async () => {
    const { prisma } = mockPrisma(null);
    expect((await settleStep(prisma, 'nope')).status).toBe('skipped');
  });

  it('skips a step that is not released', async () => {
    const { prisma } = mockPrisma(baseStep({ status: 'PENDING' }));
    const r = await settleStep(prisma, 's1');
    expect(r).toMatchObject({ status: 'skipped', reason: 'step not released' });
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
    const r = await settleStep(prisma, 's1');
    expect(r.reason).toBe('task not locked on-chain');
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
    delete process.env.SERVER_ORCHESTRATOR_KEY;
    const { prisma } = mockPrisma(baseStep());
    expect((await settleStep(prisma, 's1')).reason).toBe('settlement not configured');
  });

  it('is idempotent: skips a step already settled', async () => {
    const { prisma, created } = mockPrisma(baseStep(), true);
    const r = await settleStep(prisma, 's1');
    expect(r).toMatchObject({ status: 'skipped', reason: 'already settled' });
    expect(created).toHaveLength(0);
  });
});
