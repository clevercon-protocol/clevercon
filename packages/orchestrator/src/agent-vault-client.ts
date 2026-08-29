/**
 * AgentVault Soroban contract client (server-side).
 *
 * Delegates all Soroban interactions to `@clevercon/vault-sdk`, which wraps
 * every CleverVault entrypoint with typed inputs/outputs, structured errors,
 * and network config. This file preserves the orchestrator's existing public
 * API surface so callers (executor.ts, server.ts) require no changes.
 *
 * If AGENT_VAULT_CONTRACT_ID is not set or is a placeholder, functions that
 * require the contract return safe defaults so the system works without it.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { VaultClient, VaultContractError } from '@clevercon/vault-sdk';

export { VaultErrorCode, VaultContractError } from '@clevercon/vault-sdk';

const CONTRACT_ID = process.env.AGENT_VAULT_CONTRACT_ID ?? '';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_SAC = process.env.USDC_SAC ?? '';

export const VAULT_ACTIVE = CONTRACT_ID.length > 10 && !CONTRACT_ID.startsWith('C...');

if (!VAULT_ACTIVE) {
  console.warn('[AgentVault] AGENT_VAULT_CONTRACT_ID not set — vault features disabled');
}

// ── Singleton SDK client ─────────────────────────────────────────────────────

const vaultClient = new VaultClient({
  contractId: CONTRACT_ID,
  rpcUrl: RPC_URL,
  network: 'testnet',
  usdcSac: USDC_SAC,
});

const STROOPS_PER_USDC = 10_000_000;

// ── Submit a pre-signed XDR (signed by user in Freighter) ────────────────────

export async function submitSignedXdr(signedXdr: string): Promise<string> {
  return vaultClient.submitSignedXdr(signedXdr);
}

// ── U3: Orchestrator registration ─────────────────────────────────────────────

export async function buildRegisterOrchestratorXdr(
  userAddress: string,
  orchestratorAddress: string,
  name: string,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return vaultClient.buildRegisterOrchestratorXdr(userAddress, orchestratorAddress, name);
}

// ── U4: Deposit / withdraw XDR builders ──────────────────────────────────────

export async function buildDepositXdr(
  userAddress: string,
  amountUsdc: number,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return vaultClient.buildDepositXdr(userAddress, amountUsdc);
}

export async function buildWithdrawXdr(
  userAddress: string,
  amountUsdc: number,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return vaultClient.buildWithdrawXdr(userAddress, amountUsdc);
}

// ── U5: Task lifecycle (signed by orchestrator keypair) ────────────────────────

export async function createTask(
  orchestratorKeypair: Keypair,
  planCostUsdc: number,
): Promise<bigint | null> {
  if (!VAULT_ACTIVE) return null;
  try {
    return await vaultClient.createTask(orchestratorKeypair, planCostUsdc);
  } catch (err: any) {
    console.error('[AgentVault] createTask error:', err.message);
    return null;
  }
}

/**
 * Returns tx hash on success, null on failure (or if vault inactive).
 *
 * Re-throws `VaultContractError` (a genuine contract revert — e.g.
 * `TaskAlreadyCompleted`, `ExceedsPlanCost`) so the caller can branch on
 * `err.code`. Non-contract failures (RPC hiccups, etc.) are swallowed to `null`.
 */
export async function releasePayment(
  orchestratorKeypair: Keypair,
  taskId: bigint,
  stepId: bigint,
  amountUsdc: number,
): Promise<string | null> {
  if (!VAULT_ACTIVE || !taskId) return null;
  try {
    return await vaultClient.releasePayment(orchestratorKeypair, taskId, stepId, amountUsdc);
  } catch (err: any) {
    console.error('[AgentVault] releasePayment error:', err.message);
    if (err instanceof VaultContractError) throw err;
    return null;
  }
}

export async function completeTask(orchestratorKeypair: Keypair, taskId: bigint): Promise<void> {
  if (!VAULT_ACTIVE || !taskId) return;
  try {
    await vaultClient.completeTask(orchestratorKeypair, taskId);
  } catch (err: any) {
    console.error('[AgentVault] completeTask error:', err.message);
  }
}

// ── U7: Cancel task XDR (user signs) + Force-complete (orchestrator signs) ────

export async function buildCancelTaskXdr(
  userAddress: string,
  vaultTaskId: bigint,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  return vaultClient.buildCancelTaskXdr(userAddress, vaultTaskId);
}

export async function forceCompleteTask(
  orchestratorKeypair: Keypair,
  vaultTaskId: bigint,
): Promise<string | null> {
  if (!VAULT_ACTIVE) return null;
  try {
    await vaultClient.completeTask(orchestratorKeypair, vaultTaskId);
    return 'ok';
  } catch (err: any) {
    console.error('[AgentVault] forceCompleteTask error:', err.message);
    return null;
  }
}

// ── Read-only views ───────────────────────────────────────────────────────────

export async function getBalance(userAddress: string): Promise<bigint> {
  if (!VAULT_ACTIVE) return 0n;
  try {
    return await vaultClient.getBalance(userAddress);
  } catch {
    return 0n;
  }
}

export async function getAvailable(userAddress: string): Promise<bigint> {
  if (!VAULT_ACTIVE) return 0n;
  try {
    return await vaultClient.getAvailable(userAddress);
  } catch {
    return 0n;
  }
}

/** A user's vault account, with all amounts converted from stroops to USDC. */
export interface VaultAccount {
  balance: number;
  available: number;
  locked: number;
  total_deposited: number;
  total_spent: number;
  active_tasks_count: number;
}

export async function getAccount(userAddress: string): Promise<VaultAccount | null> {
  if (!VAULT_ACTIVE) return null;
  const raw = await vaultClient.getAccount(userAddress);
  if (!raw) {
    return {
      balance: 0,
      available: 0,
      locked: 0,
      total_deposited: 0,
      total_spent: 0,
      active_tasks_count: 0,
    };
  }
  const toUsdc = (v: bigint | number) => Number(v) / STROOPS_PER_USDC;
  return {
    balance: toUsdc(raw.balance),
    available: toUsdc(raw.balance - raw.locked),
    locked: toUsdc(raw.locked),
    total_deposited: toUsdc(raw.total_deposited),
    total_spent: toUsdc(raw.total_spent),
    active_tasks_count: raw.active_tasks_count,
  };
}
