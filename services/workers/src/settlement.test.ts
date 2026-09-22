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
    budget: string;
    policy: { commitment: string } | null;
  } | null;
}

function mockPrisma(
  step: StepRow | null,
  opts: { delegate?: boolean; existingPayment?: boolean; createError?: unknown } = {},
) {
  const { delegate = true, existingPayment = false, createError } = opts;
  const created: unknown[] = [];
  const delegateRow = delegate
    ? {
        userId: step?.task?.buyerId,
        publicKey: 'GDEL',
        secretCipher: encryptSecret(Keypair.random().secret()),
      }
    : null;
  const updated: unknown[] = [];
  const prisma = {
    taskStep: { findUnique: vi.fn(async () => step) },
    agentDelegate: { findUnique: vi.fn(async () => delegateRow) },
    task: {
      // The lazy-lock re-read: reflects the step's current on-chain lock state.
      findUnique: vi.fn(async () => ({ vaultTaskId: step?.task?.vaultTaskId ?? null })),
      update: vi.fn(async ({ data }: { data: unknown }) => {
        updated.push(data);
        return data;
      }),
    },
    payment: {
      findFirst: vi.fn(async () => (existingPayment ? { id: 'p-existing' } : null)),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        if (createError) throw createError;
        created.push(data);
        return data;
      }),
    },
  };
  return { prisma: prisma as unknown as Parameters<typeof settleStep>[0], created, updated };
}

/** A fake on-chain release that never touches the network, for unit tests. */
const fakeRelease = vi.fn(async () => 'TXHASH_TEST');

/** A real, parseable Stellar address (the proof builder validates the payee). */
const PAYEE = Keypair.random().publicKey();

function baseStep(over: Partial<StepRow> = {}): StepRow {
  return {
    id: 's1',
    index: 0,
    status: 'RELEASED',
    taskId: 't1',
    estimatedCost: '0.05',
    serviceId: 'svc1',
    service: { stellarAddress: PAYEE },
    task: {
      buyerId: 'buyer1',
      vaultTaskId: 7n,
      asset: 'USDC',
      budget: '0.05',
      policy: { commitment: 'ab'.repeat(32) },
    },
    ...over,
  };
}

/** A fake on-chain lock that never touches the network, for unit tests. */
const fakeLock = vi.fn(async () => 99n);

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

  it('lazily locks a not-yet-locked task on-chain, then releases with the new id', async () => {
    const { prisma, created, updated } = mockPrisma(
      baseStep({
        task: {
          buyerId: 'b',
          vaultTaskId: null,
          asset: 'USDC',
          budget: '0.05',
          policy: { commitment: 'ab'.repeat(32) },
        },
      }),
    );
    fakeRelease.mockClear();
    fakeLock.mockClear();
    const r = await settleStep(prisma, 's1', fakeRelease, fakeLock);
    expect(fakeLock).toHaveBeenCalledTimes(1);
    // The freshly locked vault task id is persisted and used for the release.
    expect(updated).toContainEqual({ vaultTaskId: 99n });
    expect(fakeRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 99n }),
    );
    expect(r).toMatchObject({ status: 'settled', txHash: 'TXHASH_TEST' });
    expect(created).toHaveLength(1);
  });

  const unlockedStep = () =>
    baseStep({
      task: {
        buyerId: 'b',
        vaultTaskId: null,
        asset: 'USDC',
        budget: '0.05',
        policy: { commitment: 'ab'.repeat(32) },
      },
    });

  it('marks the task FAILED (not retryable) when the lazy lock deterministically fails', async () => {
    const { prisma, updated } = mockPrisma(unlockedStep());
    // A contract rejection in simulation (e.g. InsufficientAvailable) is deterministic.
    const throwingLock = vi.fn(async () => {
      throw new Error('create_task_with_policy simulation failed: Error(Contract, #6)');
    });
    const r = await settleStep(prisma, 's1', fakeRelease, throwingLock);
    expect(r).toMatchObject({ status: 'failed', retryable: false });
    expect(updated).toContainEqual({ status: 'FAILED' });
  });

  it('leaves the task RUNNING and retryable when the lazy lock fails transiently', async () => {
    const { prisma, updated } = mockPrisma(unlockedStep());
    const throwingLock = vi.fn(async () => {
      throw new Error('create_task_with_policy timed out: abc123'); // transient
    });
    const r = await settleStep(prisma, 's1', fakeRelease, throwingLock);
    expect(r).toMatchObject({ status: 'failed', retryable: true });
    // Not marked FAILED: a retry may succeed.
    expect(updated).not.toContainEqual({ status: 'FAILED' });
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

  it('is idempotent: skips a step already settled (fast path, no on-chain call)', async () => {
    const { prisma, created } = mockPrisma(baseStep(), { existingPayment: true });
    fakeRelease.mockClear();
    const r = await settleStep(prisma, 's1', fakeRelease);
    expect(r).toMatchObject({ status: 'skipped', reason: 'already settled' });
    expect(created).toHaveLength(0);
    expect(fakeRelease).not.toHaveBeenCalled();
  });

  it('settles a released step: on-chain release then a CONFIRMED mirror row', async () => {
    const { prisma, created } = mockPrisma(baseStep());
    fakeRelease.mockClear();
    const r = await settleStep(prisma, 's1', fakeRelease);
    expect(r).toMatchObject({ status: 'settled', txHash: 'TXHASH_TEST' });
    expect(fakeRelease).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      stepId: 's1',
      method: 'VAULT_RELEASE',
      status: 'CONFIRMED',
      txHash: 'TXHASH_TEST',
      idempotencyKey: 'settle-s1',
    });
  });

  it('treats a raced mirror insert (P2002) as an already-settled skip, not a failure', async () => {
    // The release is idempotent on-chain, so a concurrent winner recording the
    // step first is benign: we must skip, never report failed (which would retry).
    const { prisma } = mockPrisma(baseStep(), { createError: { code: 'P2002' } });
    fakeRelease.mockClear();
    const r = await settleStep(prisma, 's1', fakeRelease);
    expect(r).toMatchObject({ status: 'skipped', reason: 'already settled' });
    expect(fakeRelease).toHaveBeenCalledTimes(1);
  });

  it('reports failed when the on-chain release throws (so the queue retries)', async () => {
    const { prisma, created } = mockPrisma(baseStep());
    const throwingRelease = vi.fn(async () => {
      throw new Error('rpc down');
    });
    const r = await settleStep(prisma, 's1', throwingRelease);
    // A bare RPC error is transient, so the queue should retry it.
    expect(r).toMatchObject({ status: 'failed', reason: 'rpc down', retryable: true });
    expect(created).toHaveLength(0);
  });

  it('reports failed when the mirror insert fails for a non-idempotency reason', async () => {
    const { prisma } = mockPrisma(baseStep(), { createError: new Error('db down') });
    fakeRelease.mockClear();
    const r = await settleStep(prisma, 's1', fakeRelease);
    // The on-chain release already happened; the mirror write is retryable.
    expect(r).toMatchObject({ status: 'failed', reason: 'db down', retryable: true });
  });
});
