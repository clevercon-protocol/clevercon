/**
 * AgentVault Soroban contract client (server-side).
 *
 * Mirrors the pattern from budget-contract.ts: simulate → assemble → sign → submit → poll.
 *
 * If AGENT_VAULT_CONTRACT_ID is not set or is a placeholder, functions that
 * require the contract return safe defaults so the system works without it.
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
  xdr,
} from '@stellar/stellar-sdk';

const CONTRACT_ID  = process.env.AGENT_VAULT_CONTRACT_ID ?? '';
const RPC_URL      = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const STROOPS_PER_USDC   = 10_000_000;

export const VAULT_ACTIVE =
  CONTRACT_ID.length > 10 && !CONTRACT_ID.startsWith('C...');

if (!VAULT_ACTIVE) {
  console.warn('[AgentVault] AGENT_VAULT_CONTRACT_ID not set — vault features disabled');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / STROOPS_PER_USDC;
}

function rpc() {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: false });
}

/**
 * Build + simulate a contract call, returning the assembled (unsigned) XDR.
 * Used for transactions the user must sign in Freighter.
 */
async function buildUnsignedXdr(
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const server  = rpc();
  const account = await server.getAccount(sourceAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simulated).build().toXDR();
}

/**
 * Sign and submit a transaction using a server-side keypair.
 * Returns tx hash after confirmation.
 */
async function signAndSubmit(keypair: Keypair, method: string, args: xdr.ScVal[]): Promise<string> {
  const server   = rpc();
  const account  = await server.getAccount(keypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  tx = SorobanRpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);

  const response = await server.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(response.errorResult)}`);
  }

  return pollForConfirmation(server, response.hash);
}

async function pollForConfirmation(server: SorobanRpc.Server, hash: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await server.getTransaction(hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

// ── Submit a pre-signed XDR (signed by user in Freighter) ────────────────────

export async function submitSignedXdr(signedXdr: string): Promise<string> {
  const server = rpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const response = await server.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(response.errorResult)}`);
  }
  return pollForConfirmation(server, response.hash);
}

// ── U3: Orchestrator registration ─────────────────────────────────────────────

/**
 * Build an unsigned register_orchestrator XDR.
 * The user's Freighter wallet signs this so the contract records the mapping.
 * Returns null if the vault contract is not configured.
 */
export async function buildRegisterOrchestratorXdr(
  userAddress: string,
  orchestratorAddress: string,
  name: string,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return buildUnsignedXdr(userAddress, 'register_orchestrator', [
    new Address(userAddress).toScVal(),
    new Address(orchestratorAddress).toScVal(),
    nativeToScVal(name, { type: 'string' }),
  ]);
}

// ── U4: Deposit / withdraw XDR builders ──────────────────────────────────────

export async function buildDepositXdr(userAddress: string, amountUsdc: number): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return buildUnsignedXdr(userAddress, 'deposit', [
    new Address(userAddress).toScVal(),
    nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
  ]);
}

export async function buildWithdrawXdr(userAddress: string, amountUsdc: number): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return buildUnsignedXdr(userAddress, 'withdraw', [
    new Address(userAddress).toScVal(),
    nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
  ]);
}

// ── U5: Task lifecycle (signed by orchestrator keypair) ────────────────────────

export async function createTask(orchestratorKeypair: Keypair, planCostUsdc: number): Promise<bigint | null> {
  if (!VAULT_ACTIVE) return null;
  try {
    const server = rpc();
    const account = await server.getAccount(orchestratorKeypair.publicKey());
    const contract = new Contract(CONTRACT_ID);

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('create_task',
        new Address(orchestratorKeypair.publicKey()).toScVal(),
        nativeToScVal(usdcToStroops(planCostUsdc), { type: 'i128' }),
      ))
      .setTimeout(60)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new Error(`Simulation failed: ${simulated.error}`);
    }

    tx = SorobanRpc.assembleTransaction(tx, simulated).build();
    tx.sign(orchestratorKeypair);

    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') throw new Error(`Send failed`);

    await pollForConfirmation(server, response.hash);

    // Re-fetch result
    const result = await server.getTransaction(response.hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS && result.returnValue) {
      return BigInt(scValToNative(result.returnValue));
    }
    return null;
  } catch (err: any) {
    console.error('[AgentVault] createTask error:', err.message);
    return null;
  }
}

/** Returns tx hash on success, null on failure (or if vault inactive). */
export async function releasePayment(
  orchestratorKeypair: Keypair,
  taskId: bigint,
  amountUsdc: number,
): Promise<string | null> {
  if (!VAULT_ACTIVE || !taskId) return null;
  try {
    const hash = await signAndSubmit(orchestratorKeypair, 'release_payment', [
      new Address(orchestratorKeypair.publicKey()).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
    return hash;
  } catch (err: any) {
    console.error('[AgentVault] releasePayment error:', err.message);
    return null;
  }
}

export async function completeTask(orchestratorKeypair: Keypair, taskId: bigint): Promise<void> {
  if (!VAULT_ACTIVE || !taskId) return;
  try {
    await signAndSubmit(orchestratorKeypair, 'complete_task', [
      new Address(orchestratorKeypair.publicKey()).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
  } catch (err: any) {
    console.error('[AgentVault] completeTask error:', err.message);
  }
}

// ── U7: Cancel task XDR (user signs) + Force-complete (orchestrator signs) ────

/**
 * Build an unsigned cancel_task XDR for the user to sign in Freighter.
 * This cancels an active vault task and refunds unused locked balance.
 */
export async function buildCancelTaskXdr(
  userAddress: string,
  vaultTaskId: bigint,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return buildUnsignedXdr(userAddress, 'cancel_task', [
    new Address(userAddress).toScVal(),
    nativeToScVal(vaultTaskId, { type: 'u64' }),
  ]);
}

/**
 * Force-complete a stale task using the orchestrator keypair.
 * Calls complete_task — safe to call even if already completed.
 */
export async function forceCompleteTask(
  orchestratorKeypair: Keypair,
  vaultTaskId: bigint,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  try {
    const hash = await signAndSubmit(orchestratorKeypair, 'complete_task', [
      new Address(orchestratorKeypair.publicKey()).toScVal(),
      nativeToScVal(vaultTaskId, { type: 'u64' }),
    ]);
    return hash;
  } catch (err: any) {
    console.error('[AgentVault] forceCompleteTask error:', err.message);
    return null;
  }
}

// ── Read-only views ───────────────────────────────────────────────────────────

async function callView(method: string, args: xdr.ScVal[]): Promise<any> {
  const server = rpc();
  // Use a throwaway keypair as source for read-only calls
  const dummy = Keypair.random();
  const contract = new Contract(CONTRACT_ID);

  // For view calls we need an existing account — use the contract itself or skip
  // Use the orchestrator's address if available; fall back to simulating with no source
  const tx = new TransactionBuilder(
    { accountId: () => dummy.publicKey(), sequenceNumber: () => '0', incrementSequenceNumber: () => {} } as any,
    { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
  )
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) return null;
  if (!('result' in simulated) || !simulated.result) return null;
  return scValToNative(simulated.result.retval);
}

export async function getBalance(userAddress: string): Promise<bigint> {
  if (!VAULT_ACTIVE) return 0n;
  try {
    const result = await callView('get_balance', [new Address(userAddress).toScVal()]);
    return result !== null ? BigInt(result) : 0n;
  } catch { return 0n; }
}

export async function getAvailable(userAddress: string): Promise<bigint> {
  if (!VAULT_ACTIVE) return 0n;
  try {
    const result = await callView('get_available', [new Address(userAddress).toScVal()]);
    return result !== null ? BigInt(result) : 0n;
  } catch { return 0n; }
}

export interface VaultAccount {
  balance: number;         // USDC
  available: number;       // USDC (balance - locked)
  locked: number;          // USDC
  total_deposited: number; // USDC
  total_spent: number;     // USDC
  active_tasks_count: number;
}

export async function getAccount(userAddress: string): Promise<VaultAccount | null> {
  if (!VAULT_ACTIVE) return null;
  // Let exceptions propagate — caller distinguishes RPC errors from "no account"
  const raw = await callView('get_account', [new Address(userAddress).toScVal()]);
  // Option::None from the contract → account doesn't exist yet → zero balance
  if (raw === null || raw === undefined) {
    return { balance: 0, available: 0, locked: 0, total_deposited: 0, total_spent: 0, active_tasks_count: 0 };
  }
  const toUsdc = (v: bigint | number) => Number(v) / STROOPS_PER_USDC;
  return {
    balance: toUsdc(raw.balance),
    available: toUsdc(raw.balance - raw.locked),
    locked: toUsdc(raw.locked),
    total_deposited: toUsdc(raw.total_deposited),
    total_spent: toUsdc(raw.total_spent),
    active_tasks_count: Number(raw.active_tasks_count),
  };
}
