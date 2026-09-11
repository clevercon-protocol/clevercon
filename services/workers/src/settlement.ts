import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Address,
  type xdr,
} from '@stellar/stellar-sdk';
import { PaymentMethod, PaymentStatus, decryptSecret, type PrismaClient } from '@clevercon/db';
import { buildBindingProof, generateNullifier } from '@clevercon/common';
import { logger } from './logger.js';

export interface SettleResult {
  status: 'settled' | 'skipped' | 'failed';
  reason?: string;
  txHash?: string;
  buyerId?: string;
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
  const rpcUrl = env('STELLAR_RPC_URL') || 'https://soroban-testnet.stellar.org';
  const passphrase = env('NETWORK_PASSPHRASE') || 'Test SDF Network ; September 2015';
  const contractId = env('AGENT_VAULT_CONTRACT_ID');
  const usdcSac = env('USDC_SAC');

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(kp.publicKey());
  const contract = new Contract(contractId);
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
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(contract.call('release_payment_proved', ...args))
    .setTimeout(300)
    .build();
  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`release simulation failed: ${simulated.error}`);
  }
  const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
  prepared.sign(kp);
  const response = await server.sendTransaction(prepared);
  if (response.status === 'ERROR') throw new Error('release rejected on submit');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const result = await server.getTransaction(response.hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`release failed on-chain: ${response.hash}`);
    }
  }
  throw new Error(`release timed out: ${response.hash}`);
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
  if (!step.service?.stellarAddress)
    return { status: 'skipped', reason: 'step has no payee', buyerId };
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
  if (existing) return { status: 'skipped', reason: 'already settled', buyerId };

  const amountUsdc = Number(step.estimatedCost);
  const amountStroops = BigInt(Math.round(amountUsdc * STROOPS_PER_USDC));
  const nullifier = generateNullifier();
  const { proof } = buildBindingProof({
    commitment: step.task.policy.commitment,
    payeeAddress: step.service.stellarAddress,
    amountStroops,
    nullifier,
  });

  // (1) On-chain release. Exactly-once for FUNDS is guaranteed by the vault:
  // release_payment_proved is idempotent by (task_id, step_id), so a retry after
  // a crash (or a concurrent submit) that re-runs this returns success without
  // moving funds a second time. A failure here is retryable, so report `failed`.
  let txHash: string;
  try {
    txHash = await release(delegateKp, {
      taskId: step.task.vaultTaskId,
      stepId: BigInt(step.index),
      amountStroops,
      payee: step.service.stellarAddress,
      nullifier,
      proof,
    });
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
        toAddress: step.service.stellarAddress,
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
      return { status: 'skipped', reason: 'already settled', buyerId };
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ stepId, err: reason }, 'settlement recorded on-chain but mirror failed');
    return { status: 'failed', reason, buyerId };
  }

  logger.info({ stepId, txHash, amountUsdc }, 'step settled');
  return { status: 'settled', txHash, buyerId };
}
