/**
 * Soroban Budget Guardian client.
 *
 * Wraps the on-chain BudgetGuardian contract with typed TS functions.
 * All amounts are in USDC (floats); conversion to/from stroops (×10_000_000)
 * is handled internally.
 *
 * If BUDGET_CONTRACT_ID is not set or starts with 'C...' (placeholder),
 * all functions are no-ops that return safe defaults. This lets the system
 * run without a deployed contract while development proceeds.
 */

import {
  Keypair,
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk';

const CONTRACT_ID = process.env.BUDGET_CONTRACT_ID ?? '';
const SECRET_KEY  = process.env.ORCHESTRATOR_SECRET_KEY!;
const RPC_URL     = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

const STROOPS_PER_USDC = 10_000_000n;

// Detect placeholder value — .env ships with BUDGET_CONTRACT_ID=C...
const CONTRACT_ACTIVE =
  CONTRACT_ID.length > 10 && !CONTRACT_ID.startsWith('C...');

if (!CONTRACT_ACTIVE) {
  console.warn('[BudgetContract] BUDGET_CONTRACT_ID not set — running without on-chain budget enforcement');
}

// ── Soroban helpers ───────────────────────────────────────────────────────────

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10_000_000));
}

function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / 10_000_000;
}

async function invokeContract(method: string, args: any[]): Promise<any> {
  const keypair = Keypair.fromSecret(SECRET_KEY);
  const rpc     = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const contract = new Contract(CONTRACT_ID);

  const account = await rpc.getAccount(keypair.publicKey());

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const simulated = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`[BudgetContract] Simulation failed: ${simulated.error}`);
  }

  tx = SorobanRpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);

  const response = await rpc.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`[BudgetContract] Send failed: ${JSON.stringify(response.errorResult)}`);
  }

  // Poll for confirmation
  const hash = response.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await rpc.getTransaction(hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return result.returnValue ? scValToNative(result.returnValue) : undefined;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`[BudgetContract] Transaction failed: ${hash}`);
    }
  }
  throw new Error(`[BudgetContract] Transaction timed out: ${hash}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lock a budget on-chain for a task.
 * Returns the on-chain task_id (number), or null if contract inactive.
 */
export async function createTaskBudget(budgetUsdc: number): Promise<number | null> {
  if (!CONTRACT_ACTIVE) return null;
  try {
    const keypair = Keypair.fromSecret(SECRET_KEY);
    const stroops = usdcToStroops(budgetUsdc);
    const result = await invokeContract('create_task', [
      new Address(keypair.publicKey()).toScVal(),
      nativeToScVal(stroops, { type: 'i128' }),
    ]);
    const taskId = Number(result);
    console.log(`[BudgetContract] Task ${taskId} created — budget ${budgetUsdc} USDC`);
    return taskId;
  } catch (err: any) {
    console.error('[BudgetContract] createTaskBudget error:', err.message);
    return null; // non-fatal — execution continues without on-chain guard
  }
}

/**
 * Approve a payment spend against the on-chain budget.
 * Returns true if approved, false if denied (over budget).
 * Returns true (permissive) if contract is inactive.
 */
export async function approveSpend(
  taskId: number,
  amountUsdc: number,
): Promise<boolean> {
  if (!CONTRACT_ACTIVE || taskId === null) return true;
  try {
    const keypair = Keypair.fromSecret(SECRET_KEY);
    const stroops = usdcToStroops(amountUsdc);
    const approved = await invokeContract('approve_spend', [
      new Address(keypair.publicKey()).toScVal(),
      nativeToScVal(BigInt(taskId), { type: 'u64' }),
      nativeToScVal(stroops, { type: 'i128' }),
    ]);
    console.log(`[BudgetContract] approveSpend task=${taskId} amount=${amountUsdc} → ${approved}`);
    return Boolean(approved);
  } catch (err: any) {
    console.error('[BudgetContract] approveSpend error:', err.message);
    return true; // fail-open: don't block payments if contract call fails
  }
}

/**
 * Mark a task as complete on-chain (no more spends allowed).
 */
export async function completeTask(taskId: number | null): Promise<void> {
  if (!CONTRACT_ACTIVE || taskId === null) return;
  try {
    const keypair = Keypair.fromSecret(SECRET_KEY);
    await invokeContract('complete_task', [
      new Address(keypair.publicKey()).toScVal(),
      nativeToScVal(BigInt(taskId), { type: 'u64' }),
    ]);
    console.log(`[BudgetContract] Task ${taskId} marked complete`);
  } catch (err: any) {
    console.error('[BudgetContract] completeTask error:', err.message);
  }
}

/**
 * Get remaining budget for a task (in USDC).
 * Returns null if contract inactive.
 */
export async function getRemaining(taskId: number | null): Promise<number | null> {
  if (!CONTRACT_ACTIVE || taskId === null) return null;
  try {
    const stroops = await invokeContract('get_remaining', [
      nativeToScVal(BigInt(taskId), { type: 'u64' }),
    ]);
    return stroopsToUsdc(BigInt(stroops));
  } catch (err: any) {
    console.error('[BudgetContract] getRemaining error:', err.message);
    return null;
  }
}

/**
 * Get full task record from chain.
 */
export async function getTask(taskId: number | null): Promise<{
  budget: number;
  spent: number;
  remaining: number;
  num_payments: number;
  completed: boolean;
} | null> {
  if (!CONTRACT_ACTIVE || taskId === null) return null;
  try {
    const raw = await invokeContract('get_task', [
      nativeToScVal(BigInt(taskId), { type: 'u64' }),
    ]);
    return {
      budget:       stroopsToUsdc(BigInt(raw.budget)),
      spent:        stroopsToUsdc(BigInt(raw.spent)),
      remaining:    stroopsToUsdc(BigInt(raw.budget) - BigInt(raw.spent)),
      num_payments: Number(raw.num_payments),
      completed:    Boolean(raw.completed),
    };
  } catch (err: any) {
    console.error('[BudgetContract] getTask error:', err.message);
    return null;
  }
}

export { CONTRACT_ACTIVE };
