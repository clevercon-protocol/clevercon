import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { encryptSecret } from '@clevercon/db';
import { finalizeTaskIfComplete, type CompleteFn } from './settlement.js';

interface TaskRow {
  id: string;
  buyerId: string;
  vaultTaskId: bigint | null;
  vaultFinalizedAt: Date | null;
  steps: { status: string }[];
}

function mockPrisma(task: TaskRow | null, settledCount: number, delegate = true) {
  const updates: unknown[] = [];
  const prisma = {
    task: {
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: { data: unknown }) => {
        updates.push(data);
        return data;
      }),
    },
    payment: { count: vi.fn(async () => settledCount) },
    agentDelegate: {
      findUnique: vi.fn(async () =>
        delegate
          ? { userId: task?.buyerId, secretCipher: encryptSecret(Keypair.random().secret()) }
          : null,
      ),
    },
  };
  return { prisma: prisma as unknown as Parameters<typeof finalizeTaskIfComplete>[0], updates };
}

function baseTask(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    buyerId: 'buyer1',
    vaultTaskId: 7n,
    vaultFinalizedAt: null,
    steps: [{ status: 'RELEASED' }],
    ...over,
  };
}

describe('finalizeTaskIfComplete', () => {
  beforeEach(() => {
    process.env.DELEGATE_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.AGENT_VAULT_CONTRACT_ID = 'CVAULT';
    process.env.USDC_SAC = 'CUSDC';
  });
  afterEach(() => {
    delete process.env.DELEGATE_ENCRYPTION_KEY;
    delete process.env.AGENT_VAULT_CONTRACT_ID;
    delete process.env.USDC_SAC;
    vi.restoreAllMocks();
  });

  it('finalizes when all steps are terminal and every release has settled', async () => {
    const complete: CompleteFn = vi.fn(async () => 'completed');
    const { prisma, updates } = mockPrisma(baseTask(), 1);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('finalized');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1); // vaultFinalizedAt set
  });

  it('does NOT finalize while a step is still open', async () => {
    const complete: CompleteFn = vi.fn(async () => 'completed');
    const { prisma } = mockPrisma(baseTask({ steps: [{ status: 'RUNNING' }] }), 0);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('skipped');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does NOT finalize until every released step has settled on-chain', async () => {
    const complete: CompleteFn = vi.fn(async () => 'completed');
    // two released steps, only one settled payment recorded so far
    const { prisma } = mockPrisma(
      baseTask({ steps: [{ status: 'RELEASED' }, { status: 'RELEASED' }] }),
      1,
    );
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('skipped');
    expect(complete).not.toHaveBeenCalled();
  });

  it('is idempotent: skips a task already finalized', async () => {
    const complete: CompleteFn = vi.fn(async () => 'completed');
    const { prisma } = mockPrisma(baseTask({ vaultFinalizedAt: new Date() }), 1);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('skipped');
    expect(complete).not.toHaveBeenCalled();
  });

  it('tolerates an already-completed on-chain task and still records the marker', async () => {
    const complete: CompleteFn = vi.fn(async () => 'already');
    const { prisma, updates } = mockPrisma(baseTask(), 1);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('already');
    expect(updates).toHaveLength(1);
  });

  it('leaves a disputed task to the resolver (no marker)', async () => {
    const complete: CompleteFn = vi.fn(async () => 'disputed');
    const { prisma, updates } = mockPrisma(baseTask(), 1);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('skipped');
    expect(updates).toHaveLength(0);
  });

  it('finalizes an all-failed task (no releases, nothing to settle)', async () => {
    const complete: CompleteFn = vi.fn(async () => 'completed');
    const { prisma } = mockPrisma(baseTask({ steps: [{ status: 'FAILED' }] }), 0);
    const res = await finalizeTaskIfComplete(prisma, 't1', complete);
    expect(res.status).toBe('finalized');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
