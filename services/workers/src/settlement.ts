import { Keypair, nativeToScVal, Address, type xdr } from '@stellar/stellar-sdk';
import {
  PaymentMethod,
  PaymentStatus,
  TaskMode,
  TaskStatus,
  decryptSecret,
  type PrismaClient,
} from '@clevercon/db';
import {
  buildBindingProof,
  generateNullifier,
  createRedisMutex,
  type RedisMutex,
} from '@clevercon/common';
import { logger } from './logger.js';
import { delegateMutex, submitDelegateCall, type SorobanOpts } from './sequence.js';
import { redisConnection } from './queue.js';

// Cross-process lock so a delegate signer used by BOTH the API (lock) and this
// worker (release/finalize) is only submitting one tx at a time. Gated on
// REDIS_URL so unit tests (no Redis) run without it.
let _redisMutex: RedisMutex | null = null;
function redisLock(): RedisMutex {
  if (_redisMutex) return _redisMutex;
  if (!process.env.REDIS_URL) {
    _redisMutex = { withLock: (_key, fn) => fn() };
  } else {
    _redisMutex = createRedisMutex(
      redisConnection() as unknown as Parameters<typeof createRedisMutex>[0],
    );
  }
  return _redisMutex;
}

/** Serialize a delegate's on-chain op both in-process and across processes. */
function withDelegate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return delegateMutex.runExclusive(key, () => redisLock().withLock(key, fn));
}

function sorobanOpts(): SorobanOpts {
  return {
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    passphrase: process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
    contractId: process.env.AGENT_VAULT_CONTRACT_ID ?? '',
  };
}

export interface SettleResult {
  status: 'settled' | 'skipped' | 'failed';
  reason?: string;
  txHash?: string;
  buyerId?: string;
  taskId?: string;
}

function env(key: string): string {
  return process.env[key] ?? '';
}

/**
 * Sign `release_payment_proved` with the buyer's delegate key and submit it.
 * Mirrors VaultContractService on the API side, but standalone so the worker
 * (which runs under tsx, not Nest) can settle without importing the API.
 */
async function releasePaymentProved(
  kp: Keypair,
  params: {
    taskId: bigint;
    stepId: bigint;
    amountStroops: bigint;
    payee: string;
    nullifier: Buffer;
    proof: Buffer;
  },
): Promise<string> {
  const usdcSac = env('USDC_SAC');
  const args: xdr.ScVal[] = [
    new Address(kp.publicKey()).toScVal(),
    nativeToScVal(params.taskId, { type: 'u64' }),
    nativeToScVal(params.stepId, { type: 'u64' }),
    new Address(usdcSac).toScVal(),
    nativeToScVal(params.amountStroops, { type: 'i128' }),
    new Address(params.payee).toScVal(),
    nativeToScVal(params.nullifier, { type: 'bytes' }),
    nativeToScVal(params.proof, { type: 'bytes' }),
  ];
  const { hash } = await submitDelegateCall(kp, 'release_payment_proved', args, sorobanOpts());
  return hash;
}

function settlementConfigured(): boolean {
  return !!(env('DELEGATE_ENCRYPTION_KEY') && env('AGENT_VAULT_CONTRACT_ID') && env('USDC_SAC'));
}

/** The signature of the on-chain release; injectable so settleStep is unit-testable. */
export type ReleaseFn = (
  kp: Keypair,
  params: {
    taskId: bigint;
    stepId: bigint;
    amountStroops: bigint;
    payee: string;
    nullifier: Buffer;
    proof: Buffer;
  },
) => Promise<string>;

/** A Postgres unique-constraint violation (Prisma P2002), duck-typed to avoid a hard import. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

const STROOPS_PER_USDC = 10_000_000;

/**
 * Settle one released step by paying its provider through a proof-gated vault
 * release, as the bounded delegate. Pays the provider's address directly from
 * the vault (funds never touch the delegate), and records the Payment mirror on
 * success. Honest by construction: a Payment row is written only after a real
 * on-chain release, never fabricated.
 *
 * Idempotent and safe to skip: a step that is not released, whose task is not
 * locked on-chain, that has no policy commitment or payee, or that was already
 * settled, is a no-op. Settlement never fails task execution.
 */
export async function settleStep(
  prisma: PrismaClient,
  stepId: string,
  release: ReleaseFn = releasePaymentProved,
): Promise<SettleResult> {
  const step = await prisma.taskStep.findUnique({
    where: { id: stepId },
    include: { service: true, task: { include: { policy: true } } },
  });
  if (!step) return { status: 'skipped', reason: 'step not found' };
  const buyerId = step.task?.buyerId;
  if (step.status !== 'RELEASED')
    return { status: 'skipped', reason: 'step not released', buyerId };
  if (!step.task?.vaultTaskId)
    return { status: 'skipped', reason: 'task not locked on-chain', buyerId };
  if (!step.task.policy?.commitment)
    return { status: 'skipped', reason: 'task has no policy commitment', buyerId };
  // A direct PAY/DISBURSE step names its own payee; a hire step pays its service.
  const payee = step.payee ?? step.service?.stellarAddress ?? null;
  if (!payee) return { status: 'skipped', reason: 'step has no payee', buyerId };
  if (!settlementConfigured())
    return { status: 'skipped', reason: 'settlement not configured', buyerId };

  // The buyer's own delegate signs the release (bounded by their policy).
  const delegate = buyerId
    ? await prisma.agentDelegate.findUnique({ where: { userId: buyerId } })
    : null;
  if (!delegate) return { status: 'skipped', reason: 'buyer has no delegate', buyerId };
  const delegateKp = Keypair.fromSecret(decryptSecret(delegate.secretCipher));

  // Fast path: one vault-release payment per step. Skips the common
  // already-settled case (idempotent replay of executeTask, a re-enqueued job)
  // WITHOUT an on-chain call. A genuine concurrent race that slips past this is
  // still caught below by the unique idempotencyKey.
  const existing = await prisma.payment.findFirst({
    where: { stepId, method: PaymentMethod.VAULT_RELEASE },
  });
  if (existing)
    return { status: 'skipped', reason: 'already settled', buyerId, taskId: step.taskId };

  const amountUsdc = Number(step.estimatedCost);
  const amountStroops = BigInt(Math.round(amountUsdc * STROOPS_PER_USDC));
  const nullifier = generateNullifier();
  const { proof } = buildBindingProof({
    commitment: step.task.policy.commitment,
    payeeAddress: payee,
    amountStroops,
    nullifier,
  });

  // (1) On-chain release. Exactly-once for FUNDS is guaranteed by the vault:
  // release_payment_proved is idempotent by (task_id, step_id), so a retry after
  // a crash (or a concurrent submit) that re-runs this returns success without
  // moving funds a second time. A failure here is retryable, so report `failed`.
  const vaultTaskId = step.task.vaultTaskId;
  const stepIndex = BigInt(step.index);
  let txHash: string;
  try {
    // Serialize all on-chain ops for this delegate (per-signer), in-process and
    // across processes (the API lock uses the same signer), so releases never
    // race the sequence number while different users settle in parallel.
    txHash = await withDelegate(delegateKp.publicKey(), () =>
      release(delegateKp, {
        taskId: vaultTaskId,
        stepId: stepIndex,
        amountStroops,
        payee,
        nullifier,
        proof,
      }),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ stepId, err: reason }, 'settlement failed');
    return { status: 'failed', reason, buyerId };
  }

  // (2) Record the mirror. Exactly-once for the RECORD is guaranteed by the
  // unique idempotencyKey: if a concurrent settlement recorded this step first,
  // the create hits P2002. That is a benign race (the on-chain release above was
  // idempotent, so funds moved exactly once), so treat it as an already-settled
  // skip rather than a `failed` that would make the queue retry and re-submit.
  try {
    await prisma.payment.create({
      data: {
        taskId: step.taskId,
        stepId,
        fromAddress: env('AGENT_VAULT_CONTRACT_ID'),
        toAddress: payee,
        asset: step.task.asset,
        amount: step.estimatedCost,
        method: PaymentMethod.VAULT_RELEASE,
        status: PaymentStatus.CONFIRMED,
        txHash,
        idempotencyKey: `settle-${stepId}`,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.info({ stepId, txHash }, 'settlement raced; step already recorded');
      return { status: 'skipped', reason: 'already settled', buyerId, taskId: step.taskId };
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ stepId, err: reason }, 'settlement recorded on-chain but mirror failed');
    return { status: 'failed', reason, buyerId };
  }

  logger.info({ stepId, txHash, amountUsdc }, 'step settled');
  return { status: 'settled', txHash, buyerId, taskId: step.taskId };
}

// ── On-chain task finalization ────────────────────────────────────────────────
// Releases add to `spent` but the vault only unlocks the remaining budget and
// decrements the active-task count in `complete_task` (finalize). Without it,
// `locked` accumulates, `available` (and withdraw) drift, and a user eventually
// hits TooManyActiveTasks. We finalize once every released step of a task has
// settled on-chain.

/** Parse a Soroban contract error code from a simulation error string. */
function contractErrorCode(msg: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** Sign `complete_task` with the buyer's delegate and submit; tolerant of re-calls. */
async function completeTaskOnChain(
  kp: Keypair,
  taskId: bigint,
): Promise<'completed' | 'already' | 'disputed'> {
  const args: xdr.ScVal[] = [
    new Address(kp.publicKey()).toScVal(),
    nativeToScVal(taskId, { type: 'u64' }),
  ];
  try {
    await submitDelegateCall(kp, 'complete_task', args, sorobanOpts());
    return 'completed';
  } catch (err) {
    const code = contractErrorCode(err instanceof Error ? err.message : String(err));
    if (code === 9) return 'already'; // TaskAlreadyCompleted (idempotent)
    if (code === 19) return 'disputed'; // TaskDisputed (leave to the resolver)
    throw err;
  }
}

export type CompleteFn = (kp: Keypair, taskId: bigint) => Promise<'completed' | 'already' | 'disputed'>;

const NON_TERMINAL_STEP = ['PENDING', 'RUNNING', 'AWAITING_APPROVAL'];

/**
 * Finalize the on-chain task once all its steps are terminal AND every released
 * step has settled on-chain (a CONFIRMED VAULT_RELEASE payment). This unlocks
 * the remaining budget, refunds the unused amount to the user, and decrements
 * the active-task count. Idempotent: gated on task.vaultFinalizedAt and tolerant
 * of TaskAlreadyCompleted, so concurrent settlements of a multi-line task race
 * harmlessly (one finalizes, the rest see it done).
 */
export async function finalizeTaskIfComplete(
  prisma: PrismaClient,
  taskId: string,
  complete: CompleteFn = completeTaskOnChain,
): Promise<{ status: 'finalized' | 'already' | 'skipped'; reason?: string }> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { steps: true } });
  if (!task) return { status: 'skipped', reason: 'task not found' };
  if (!task.vaultTaskId) return { status: 'skipped', reason: 'not locked on-chain' };
  if (task.vaultFinalizedAt) return { status: 'skipped', reason: 'already finalized' };
  if (!settlementConfigured()) return { status: 'skipped', reason: 'settlement not configured' };

  const stillOpen = task.steps.some((s) => NON_TERMINAL_STEP.includes(s.status));
  if (stillOpen) return { status: 'skipped', reason: 'steps still open' };

  // Do not finalize until every released step has actually settled on-chain, or
  // complete_task would close the task before the remaining releases land.
  const releasedCount = task.steps.filter((s) => s.status === 'RELEASED').length;
  const settledCount = await prisma.payment.count({
    where: { taskId, method: PaymentMethod.VAULT_RELEASE, status: PaymentStatus.CONFIRMED },
  });
  if (settledCount < releasedCount)
    return { status: 'skipped', reason: 'releases not all settled yet' };

  const delegate = await prisma.agentDelegate.findUnique({ where: { userId: task.buyerId } });
  if (!delegate) return { status: 'skipped', reason: 'buyer has no delegate' };
  const kp = Keypair.fromSecret(decryptSecret(delegate.secretCipher));

  const vaultTaskId = task.vaultTaskId;
  let outcome: 'completed' | 'already' | 'disputed';
  try {
    // Same per-signer serialization as releases (in-process + cross-process):
    // complete_task must not race a release or an API lock for the same delegate.
    outcome = await withDelegate(kp.publicKey(), () => complete(kp, vaultTaskId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ taskId, err: reason }, 'finalize failed');
    return { status: 'skipped', reason };
  }
  if (outcome === 'disputed') return { status: 'skipped', reason: 'task disputed' };

  // PAY/DISBURSE tasks have no executor to mark them done, so complete them here
  // once finalized. Never override a FAILED/CANCELLED/DISPUTED terminal state.
  const completeStatus =
    (task.mode === TaskMode.PAY || task.mode === TaskMode.DISBURSE) &&
    task.status !== TaskStatus.FAILED &&
    task.status !== TaskStatus.CANCELLED &&
    task.status !== TaskStatus.DISPUTED;
  await prisma.task.update({
    where: { id: taskId },
    data: { vaultFinalizedAt: new Date(), ...(completeStatus ? { status: TaskStatus.COMPLETED } : {}) },
  });
  logger.info(
    { taskId, vaultTaskId: String(task.vaultTaskId), outcome },
    'task finalized on-chain (budget unlocked)',
  );
  return { status: outcome === 'already' ? 'already' : 'finalized' };
}
