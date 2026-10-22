import {
  Keypair,
  nativeToScVal,
  Address,
  xdr,
  Contract,
  TransactionBuilder,
  scValToNative,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
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
  resolveNetwork,
  assertNetworkConsistent,
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
  const net = resolveNetwork(process.env.NETWORK);
  const passphrase = process.env.NETWORK_PASSPHRASE || net.passphrase;
  const rpcUrl = process.env.STELLAR_RPC_URL || net.defaultSorobanRpcUrl;
  // Fail before signing if NETWORK=mainnet but the config is still testnet.
  assertNetworkConsistent(process.env.NETWORK, {
    passphrase,
    rpcUrl,
    usdcSac: process.env.USDC_SAC,
  });
  return {
    rpcUrl,
    passphrase,
    // The single active vault. Every on-chain path (release, batch release, lock,
    // finalize) targets it, so pointing AGENT_VAULT_CONTRACT_ID at a vault moves
    // the whole app onto it.
    contractId: process.env.AGENT_VAULT_CONTRACT_ID || '',
  };
}

export interface SettleResult {
  status: 'settled' | 'skipped' | 'failed';
  reason?: string;
  txHash?: string;
  buyerId?: string;
  taskId?: string;
  /** The paid provider (service owner), so the worker can send a payout alert. */
  providerId?: string;
  /** The amount paid to the provider (USDC), for the payout alert. */
  amountUsdc?: number;
  /** The service that was paid, for the payout alert. */
  serviceName?: string;
  /**
   * Only set on `failed`. True when the failure is transient (RPC blip, timeout,
   * sequence contention) and the caller should let the queue retry; false when it
   * is deterministic (the contract rejected the call in simulation or on apply)
   * and a retry would just fail again.
   */
  retryable?: boolean;
  /** Set when this failure moved the task to a terminal FAILED state. */
  taskFailed?: boolean;
}

/**
 * A deterministic chain failure is one where the contract rejected the call in
 * simulation or applied and failed on-chain: retrying is pointless. Everything
 * else the submit path can throw (timeouts, txBadSeq exhaustion, submit
 * rejections, RPC/network errors) is transient and worth a retry.
 */
function isDeterministicChainError(msg: string): boolean {
  return /simulation failed|failed on-chain/i.test(msg);
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

/**
 * Sign `release_payment_proved_batch` (pp/2) with the buyer's delegate key and
 * submit it: one Groth16 proof authorizes up to N private payouts on-chain. The
 * proof is produced client-side by the SDK (`createBatchProof`); the delegate is
 * a relayer here, it cannot forge the proof, only submit it. Vec and struct args
 * are built explicitly to match the vault's `release_payment_proved_batch`
 * signature (payees, amounts, nullifiers, validity window, Groth16Proof{a,b,c}).
 */
export async function releasePaymentProvedBatch(
  kp: Keypair,
  params: {
    taskId: bigint;
    stepId: bigint;
    payees: string[];
    amountsStroops: bigint[];
    nullifiers: Buffer[];
    validAfter: bigint;
    validBefore: bigint;
    resetR2: boolean;
    resetR7: boolean;
    proof: { a: Buffer; b: Buffer; c: Buffer };
  },
): Promise<string> {
  const args: xdr.ScVal[] = [
    new Address(kp.publicKey()).toScVal(),
    nativeToScVal(params.taskId, { type: 'u64' }),
    nativeToScVal(params.stepId, { type: 'u64' }),
    new Address(env('USDC_SAC')).toScVal(),
    xdr.ScVal.scvVec(params.payees.map((p) => new Address(p).toScVal())),
    xdr.ScVal.scvVec(params.amountsStroops.map((a) => nativeToScVal(a, { type: 'i128' }))),
    xdr.ScVal.scvVec(params.nullifiers.map((n) => nativeToScVal(n, { type: 'bytes' }))),
    nativeToScVal(params.validAfter, { type: 'u64' }),
    nativeToScVal(params.validBefore, { type: 'u64' }),
    xdr.ScVal.scvBool(params.resetR2),
    xdr.ScVal.scvBool(params.resetR7),
    nativeToScVal(
      { a: params.proof.a, b: params.proof.b, c: params.proof.c },
      {
        type: {
          a: ['symbol', 'bytes'],
          b: ['symbol', 'bytes'],
          c: ['symbol', 'bytes'],
        },
      },
    ),
  ];
  const { hash } = await submitDelegateCall(
    kp,
    'release_payment_proved_batch',
    args,
    sorobanOpts(),
  );
  return hash;
}

/**
 * Sign `create_task_with_policy` with the buyer's delegate and submit it, locking
 * the plan budget on-chain under the policy commitment and returning the new
 * vault task id. Mirrors the API's VaultContractService, moved here so the lock
 * happens off the API request path (in settlement) rather than blocking it.
 */
async function createTaskWithPolicyOnChain(
  kp: Keypair,
  planCostUsdc: number,
  commitmentHex: string,
): Promise<bigint> {
  const commitment = Buffer.from(commitmentHex, 'hex');
  if (commitment.length !== 32) throw new Error('policy commitment must be 32 bytes');
  const planCostStroops = BigInt(Math.round(planCostUsdc * STROOPS_PER_USDC));
  const args: xdr.ScVal[] = [
    new Address(kp.publicKey()).toScVal(),
    new Address(env('USDC_SAC')).toScVal(),
    nativeToScVal(planCostStroops, { type: 'i128' }),
    nativeToScVal(commitment, { type: 'bytes' }),
  ];
  const { returnValue } = await submitDelegateCall(
    kp,
    'create_task_with_policy',
    args,
    sorobanOpts(),
  );
  return BigInt(returnValue as string | number | bigint);
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

/** The signature of the on-chain lock; injectable so settleStep is unit-testable. */
export type LockFn = (kp: Keypair, planCostUsdc: number, commitmentHex: string) => Promise<bigint>;

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
 * Idempotent and safe to skip: a step that is not released, has no policy
 * commitment or payee, or that was already settled, is a no-op. If the task is
 * not yet locked on-chain, this locks it lazily (the async lock). Settlement
 * never fails task execution.
 */
export async function settleStep(
  prisma: PrismaClient,
  stepId: string,
  release: ReleaseFn = releasePaymentProved,
  lock: LockFn = createTaskWithPolicyOnChain,
): Promise<SettleResult> {
  const step = await prisma.taskStep.findUnique({
    where: { id: stepId },
    include: { service: true, task: { include: { policy: true } } },
  });
  if (!step) return { status: 'skipped', reason: 'step not found' };
  const buyerId = step.task?.buyerId;
  if (step.status !== 'RELEASED')
    return { status: 'skipped', reason: 'step not released', buyerId };
  if (!step.task) return { status: 'skipped', reason: 'step has no task', buyerId };
  // The task is locked on-chain lazily here (see below), so a missing vaultTaskId
  // is no longer a skip; a missing policy commitment still is (nothing to bind to).
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

  // (1) Lock-if-needed, then release. Both the lock and the release are on-chain
  // ops for the buyer's delegate, so they run inside one per-signer serialized
  // section (in-process + cross-process, since the same signer is used
  // everywhere) to never race the sequence number while other users settle in
  // parallel. Exactly-once for FUNDS is guaranteed by the vault:
  // create_task_with_policy yields one task id (reused by later steps) and
  // release_payment_proved is idempotent by (task_id, step_id), so a retry after
  // a crash returns success without moving funds twice. A failure here is
  // retryable, so report `failed`.
  const alreadyLocked = step.task.vaultTaskId;
  const commitment = step.task.policy.commitment;
  const planCostUsdc = Number(step.task.budget);
  const stepIndex = BigInt(step.index);
  let txHash: string;
  try {
    txHash = await withDelegate(delegateKp.publicKey(), async () => {
      // Lazily lock the task budget on-chain (the async lock, moved out of the
      // API request path). The first step of a multi-line disburse to reach here
      // locks; the rest, serialized on this same delegate key, reuse the id.
      let vaultTaskId = alreadyLocked;
      if (!vaultTaskId) {
        const fresh = await prisma.task.findUnique({
          where: { id: step.taskId },
          select: { vaultTaskId: true },
        });
        vaultTaskId = fresh?.vaultTaskId ?? null;
        if (!vaultTaskId) {
          vaultTaskId = await lock(delegateKp, planCostUsdc, commitment);
          await prisma.task.update({ where: { id: step.taskId }, data: { vaultTaskId } });
          logger.info(
            { taskId: step.taskId, vaultTaskId: String(vaultTaskId) },
            'task locked on-chain (async)',
          );
        }
      }
      if (!vaultTaskId) throw new Error('task lock did not yield a vault task id');
      return release(delegateKp, {
        taskId: vaultTaskId,
        stepId: stepIndex,
        amountStroops,
        payee,
        nullifier,
        proof,
      });
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const deterministic = isDeterministicChainError(reason);
    logger.error({ stepId, err: reason, deterministic }, 'settlement failed');
    // If the lock itself deterministically failed (e.g. InsufficientAvailable in
    // simulation), the task can never settle, so mark it FAILED rather than let
    // the queue retry forever. A transient lock failure is left RUNNING to retry,
    // and a release failure after a successful lock is never marked FAILED here.
    let taskFailed = false;
    if (deterministic && !alreadyLocked) {
      const check = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { vaultTaskId: true },
      });
      if (!check?.vaultTaskId) {
        await prisma.task
          .update({ where: { id: step.taskId }, data: { status: TaskStatus.FAILED } })
          .then(() => {
            taskFailed = true;
          })
          .catch(() => {});
      }
    }
    return {
      status: 'failed',
      reason,
      buyerId,
      taskId: step.taskId,
      retryable: !deterministic,
      taskFailed,
    };
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
    // The on-chain release is idempotent by (task, step), so retrying re-records
    // the mirror without moving funds again: this db failure is worth a retry.
    return { status: 'failed', reason, buyerId, retryable: true };
  }

  logger.info({ stepId, txHash, amountUsdc }, 'step settled');
  return {
    status: 'settled',
    txHash,
    buyerId,
    taskId: step.taskId,
    providerId: step.service?.providerId ?? undefined,
    amountUsdc,
    serviceName: step.service?.name,
  };
}

/** The job payload for a pp/2 batch release (all JSON-safe; the client proved). */
export interface BatchSettlePayload {
  buyerId: string;
  /** On-chain vault task id if the task is already locked; else null to lock it. */
  vaultTaskId: string | null;
  /** Policy commitment (hex) the proof is bound to; used to lock the task. */
  commitmentHex: string;
  /** Task budget to lock (USDC) if not already locked. */
  planCostUsdc: number;
  /** On-chain step id (the vault is idempotent by (task_id, step_id)). */
  stepId: number;
  payees: string[];
  amountsStroops: string[];
  /** Active nullifiers as hex. */
  nullifiers: string[];
  validAfter: string;
  validBefore: string;
  /** Proven tumbling-window reset flags (circuit outputs) for the R2/R7 accumulators. */
  resetR2: boolean;
  resetR7: boolean;
  proof: { a: string; b: string; c: string };
}

/**
 * Settle a pp/2 batch: the owner/agent proved client-side, this relayer submits
 * `release_payment_proved_batch` with the buyer's delegate (it cannot forge the
 * proof, only submit it). Lazily locks the task on-chain if needed. The vault is
 * idempotent by (task_id, step_id) and the indexer records the release event, so
 * no per-leg DB write is needed here. Runs inside the per-signer serialized
 * section so it never races the delegate's sequence number.
 */
/**
 * Mirror a pp/2 batch into the DB so it appears in the owner's Activity and the UI
 * can confirm the outcome. A Task (mode DISBURSE) plus a Payment per payee on
 * success; a FAILED Task on a failed release (the funds were rolled back, but the
 * attempt is still worth showing). Keyed by (buyerId, stepId) so a replay never
 * double-logs. Best-effort: the money has already moved on-chain, so a logging
 * hiccup must never change the settlement outcome.
 */
async function recordBatchActivity(
  prisma: PrismaClient,
  payload: BatchSettlePayload,
  outcome: { ok: true; txHash: string } | { ok: false; reason: string },
): Promise<void> {
  try {
    const asset = env('USDC_SAC');
    const wallet = await prisma.wallet.findFirst({
      where: { userId: payload.buyerId },
      orderBy: { createdAt: 'asc' },
    });
    const fromAddress = wallet?.address ?? 'vault';
    const amounts = payload.amountsStroops.map((s) => Number(BigInt(s)) / STROOPS_PER_USDC);
    const total = amounts.reduce((a, b) => a + b, 0);
    const n = payload.payees.length;
    const idemKey = `batch-${payload.buyerId}-${payload.stepId}`;
    const title = `Disburse to ${n} recipient${n === 1 ? '' : 's'}`;

    const task = await prisma.task.upsert({
      where: { buyerId_idempotencyKey: { buyerId: payload.buyerId, idempotencyKey: idemKey } },
      update: {
        status: outcome.ok ? TaskStatus.COMPLETED : TaskStatus.FAILED,
        vaultFinalizedAt: outcome.ok ? new Date() : null,
      },
      create: {
        buyerId: payload.buyerId,
        title,
        mode: TaskMode.DISBURSE,
        budget: total,
        asset,
        status: outcome.ok ? TaskStatus.COMPLETED : TaskStatus.FAILED,
        vaultTaskId: payload.vaultTaskId ? BigInt(payload.vaultTaskId) : null,
        vaultFinalizedAt: outcome.ok ? new Date() : null,
        idempotencyKey: idemKey,
      },
    });

    if (outcome.ok) {
      for (let i = 0; i < n; i++) {
        await prisma.payment.upsert({
          where: { idempotencyKey: `${idemKey}-${i}` },
          update: { status: PaymentStatus.CONFIRMED, txHash: outcome.txHash },
          create: {
            taskId: task.id,
            fromAddress,
            toAddress: payload.payees[i],
            asset,
            amount: amounts[i],
            method: PaymentMethod.VAULT_RELEASE,
            status: PaymentStatus.CONFIRMED,
            txHash: outcome.txHash,
            idempotencyKey: `${idemKey}-${i}`,
          },
        });
      }
    }
  } catch (err) {
    logger.warn({ buyerId: payload.buyerId, err: String(err) }, 'batch activity log failed');
  }
}

export async function settleBatch(
  prisma: PrismaClient,
  payload: BatchSettlePayload,
): Promise<SettleResult> {
  if (!settlementConfigured())
    return {
      status: 'skipped',
      reason: 'settlement not configured',
      buyerId: payload.buyerId,
    };

  const delegate = await prisma.agentDelegate.findUnique({ where: { userId: payload.buyerId } });
  if (!delegate)
    return { status: 'skipped', reason: 'buyer has no delegate', buyerId: payload.buyerId };
  const delegateKp = Keypair.fromSecret(decryptSecret(delegate.secretCipher));

  const proof = {
    a: Buffer.from(payload.proof.a, 'hex'),
    b: Buffer.from(payload.proof.b, 'hex'),
    c: Buffer.from(payload.proof.c, 'hex'),
  };

  try {
    const txHash = await withDelegate(delegateKp.publicKey(), async () => {
      let vaultTaskId = payload.vaultTaskId ? BigInt(payload.vaultTaskId) : null;
      let lockedHere = false;
      if (vaultTaskId === null) {
        vaultTaskId = await createTaskWithPolicyOnChain(
          delegateKp,
          payload.planCostUsdc,
          payload.commitmentHex,
        );
        lockedHere = true;
      }
      try {
        const hash = await releasePaymentProvedBatch(delegateKp, {
          taskId: vaultTaskId,
          stepId: BigInt(payload.stepId),
          payees: payload.payees,
          amountsStroops: payload.amountsStroops.map((a) => BigInt(a)),
          nullifiers: payload.nullifiers.map((n) => Buffer.from(n, 'hex')),
          validAfter: BigInt(payload.validAfter),
          validBefore: BigInt(payload.validBefore),
          resetR2: payload.resetR2,
          resetR7: payload.resetR7,
          proof,
        });
        // A pp/2 batch owns its whole on-chain task and spends the full plan_cost in
        // this single release, so finalize NOW to unlock the budget: the vault only
        // frees `locked` in complete_task. Without this, every disburse strands its
        // locked budget. Best-effort: the funds already moved, so a failed finalize
        // just leaves the lock for the recovery sweep.
        try {
          await completeTaskOnChain(delegateKp, vaultTaskId);
        } catch (finErr) {
          logger.warn(
            { vaultTaskId: String(vaultTaskId), err: String(finErr) },
            'post-release complete_task failed; budget stays locked until re-finalized',
          );
        }
        return hash;
      } catch (releaseErr) {
        // The lock succeeded but the release did not. Roll the lock back so the
        // budget is never stranded; the job is then marked non-retryable so a retry
        // can never create a second lock for the same disbursement.
        if (lockedHere) {
          try {
            await completeTaskOnChain(delegateKp, vaultTaskId);
            logger.info(
              { vaultTaskId: String(vaultTaskId) },
              'rolled back batch lock after release failure',
            );
          } catch (rbErr) {
            logger.error(
              { vaultTaskId: String(vaultTaskId), err: String(rbErr) },
              'rollback complete_task failed; budget may remain locked (recoverable via sweep)',
            );
          }
        }
        throw releaseErr;
      }
    });
    logger.info(
      { buyerId: payload.buyerId, txHash, legs: payload.payees.length },
      'batch settled (pp/2)',
    );
    await recordBatchActivity(prisma, payload, { ok: true, txHash });
    return { status: 'settled', txHash, buyerId: payload.buyerId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ buyerId: payload.buyerId, err: reason }, 'batch settlement failed');
    await recordBatchActivity(prisma, payload, { ok: false, reason });
    // We roll back the lock on failure, so this is non-retryable on purpose: a
    // retry would lock a fresh task (vaultTaskId is null) and double-reserve the
    // budget. The owner re-submits a new proof instead.
    return { status: 'failed', reason, buyerId: payload.buyerId, retryable: false };
  }
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
export async function completeTaskOnChain(
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

export type CompleteFn = (
  kp: Keypair,
  taskId: bigint,
) => Promise<'completed' | 'already' | 'disputed'>;

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
): Promise<{
  status: 'finalized' | 'already' | 'skipped';
  reason?: string;
  mode?: TaskMode;
  /** True only when THIS call flipped the task to COMPLETED (fire completion once). */
  completed?: boolean;
}> {
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

  // Finalizing means every step settled on-chain, so the task is done. Complete it
  // now unless it is already terminal. A normal hire is already COMPLETED by the
  // executor (so completedHere is false and no duplicate completion fires); a held
  // T2 hire (left RUNNING for its window) and a PAY/DISBURSE are completed here.
  const terminal =
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.CANCELLED ||
    task.status === TaskStatus.DISPUTED;
  const completedHere = !terminal && task.status !== TaskStatus.COMPLETED;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      vaultFinalizedAt: new Date(),
      ...(completedHere ? { status: TaskStatus.COMPLETED } : {}),
    },
  });
  logger.info(
    { taskId, vaultTaskId: String(task.vaultTaskId), outcome },
    'task finalized on-chain (budget unlocked)',
  );
  return {
    status: outcome === 'already' ? 'already' : 'finalized',
    mode: task.mode,
    completed: completedHere,
  };
}

// ── Recovery: unlock orphan batch-disburse locks ──────────────────────────────
// Each pp/2 batch locks an on-chain task that has no DB Task row. Before the
// finalize-on-settle fix above, those locks were never freed, so a disburse could
// leave its budget permanently `locked`. This sweeps a user's on-chain tasks and
// completes any still locked AND untracked by a DB Task (the orphan batch locks),
// returning the budget to `available`.

/** Read a vault view function via simulation (no signature moves funds). */
async function simulateVaultRead(
  kp: Keypair,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal | null> {
  const opts = sorobanOpts();
  const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: opts.passphrase })
    .addOperation(new Contract(opts.contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`simulate ${method}: ${sim.error}`);
  return sim.result?.retval ?? null;
}

/**
 * Unlock a user's stranded batch-disburse locks. Finds the user's on-chain tasks
 * that are still locked and NOT tracked by a DB Task, and completes them to return
 * the budget. Idempotent (complete_task tolerates re-calls). Runs with the user's
 * delegate, so it must run where DELEGATE_ENCRYPTION_KEY is configured.
 */
export async function recoverOrphanLocks(
  prisma: PrismaClient,
  userId: string,
): Promise<{ unlocked: string[]; skipped: number }> {
  if (!settlementConfigured()) throw new Error('settlement not configured');
  const delegate = await prisma.agentDelegate.findUnique({ where: { userId } });
  if (!delegate) throw new Error('user has no delegate');
  const kp = Keypair.fromSecret(decryptSecret(delegate.secretCipher));
  const wallets = await prisma.wallet.findMany({ where: { userId }, select: { address: true } });

  const unlocked: string[] = [];
  let skipped = 0;
  for (const w of wallets) {
    const idsVal = await simulateVaultRead(kp, 'get_user_tasks', [
      new Address(w.address).toScVal(),
    ]);
    const rawIds = idsVal ? (scValToNative(idsVal) as (bigint | number)[]) : [];
    for (const raw of rawIds) {
      const id = BigInt(raw);
      const taskVal = await simulateVaultRead(kp, 'get_task', [nativeToScVal(id, { type: 'u64' })]);
      const task = taskVal ? (scValToNative(taskVal) as Record<string, unknown> | null) : null;
      if (!task || task.completed === true) {
        skipped++;
        continue;
      }
      // Only orphan batch locks: a DB-tracked task finalizes via
      // finalizeTaskIfComplete and may still be mid-flight, so never touch it here.
      const dbTask = await prisma.task.findFirst({ where: { vaultTaskId: id } });
      if (dbTask) {
        skipped++;
        continue;
      }
      try {
        const outcome = await withDelegate(kp.publicKey(), () => completeTaskOnChain(kp, id));
        if (outcome === 'disputed') {
          skipped++;
          continue;
        }
        unlocked.push(id.toString());
        logger.info({ userId, taskId: String(id), outcome }, 'recovered orphan locked task');
      } catch (e) {
        skipped++;
        logger.error(
          { userId, taskId: String(id), err: String(e) },
          'recover complete_task failed',
        );
      }
    }
  }
  return { unlocked, skipped };
}
