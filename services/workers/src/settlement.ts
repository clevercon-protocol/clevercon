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
import { PaymentMethod, PaymentStatus, type PrismaClient } from '@clevercon/db';
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
 * Sign `release_payment_proved` with the platform delegate key and submit it.
 * Mirrors VaultContractService on the API side, but standalone so the worker
 * (which runs under tsx, not Nest) can settle without importing the API.
 */
async function releasePaymentProved(params: {
  taskId: bigint;
  stepId: bigint;
  amountStroops: bigint;
  payee: string;
  nullifier: Buffer;
  proof: Buffer;
}): Promise<string> {
  const rpcUrl = env('STELLAR_RPC_URL') || 'https://soroban-testnet.stellar.org';
  const passphrase = env('NETWORK_PASSPHRASE') || 'Test SDF Network ; September 2015';
  const contractId = env('AGENT_VAULT_CONTRACT_ID');
  const usdcSac = env('USDC_SAC');
  const kp = Keypair.fromSecret(env('SERVER_ORCHESTRATOR_KEY'));

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
  return !!(env('SERVER_ORCHESTRATOR_KEY') && env('AGENT_VAULT_CONTRACT_ID') && env('USDC_SAC'));
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
export async function settleStep(prisma: PrismaClient, stepId: string): Promise<SettleResult> {
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

  // Idempotency: one vault-release payment per step.
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

  try {
    const txHash = await releasePaymentProved({
      taskId: step.task.vaultTaskId,
      stepId: BigInt(step.index),
      amountStroops,
      payee: step.service.stellarAddress,
      nullifier,
      proof,
    });
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
    logger.info({ stepId, txHash, amountUsdc }, 'step settled');
    return { status: 'settled', txHash, buyerId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ stepId, err: reason }, 'settlement failed');
    return { status: 'failed', reason, buyerId };
  }
}
