/**
 * Frontend CleverVault client — talks to the Soroban contract directly.
 *
 * Deposits, withdrawals, and balance reads run entirely in the browser against
 * Soroban RPC: build + simulate here, sign in the connected wallet, submit here.
 * No backend is required, so these stay real even on a static (Vercel) deploy.
 * All USDC amounts are decimal (e.g. 1.5 = $1.50).
 */

import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  SOROBAN_RPC_URL,
  VAULT_CONTRACT_ID,
  USDC_SAC,
  NETWORK_PASSPHRASE,
} from './config';

const STROOPS_PER_USDC = 10_000_000;

export interface VaultAccount {
  balance: number;
  available: number;
  locked: number;
  total_deposited: number;
  total_spent: number;
  active_tasks_count: number;
}

function server() {
  return new SorobanRpc.Server(SOROBAN_RPC_URL);
}

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

function usdcAsset(): xdr.ScVal {
  return new Address(USDC_SAC).toScVal();
}

function vault(): Contract {
  return new Contract(VAULT_CONTRACT_ID);
}

/**
 * Build + simulate a contract call, returning the assembled unsigned XDR for
 * the connected wallet to sign.
 */
async function buildUnsignedXdr(
  source: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const s = server();
  const account = await s.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(vault().call(method, ...args))
    .setTimeout(300)
    .build();

  const sim = await s.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error || 'Simulation failed');
  }
  return SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
}

/**
 * Read-only view call: simulate against the given source account, no signing.
 * `source` must be a real, existing account (the connected wallet), otherwise
 * the SDK rejects it and the read fails.
 */
async function callView(method: string, args: xdr.ScVal[], source: string): Promise<any> {
  const s = server();
  const src = {
    accountId: () => source,
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  } as any;
  const tx = new TransactionBuilder(src, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(vault().call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await s.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) return null;
  if (!('result' in sim) || !sim.result) return null;
  return scValToNative(sim.result.retval);
}

async function pollForConfirmation(hash: string): Promise<string> {
  const s = server();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await s.getTransaction(hash);
    if (r.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (r.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

export async function fetchVaultAccount(userAddress: string): Promise<VaultAccount> {
  const raw = await callView('get_account', [
    new Address(userAddress).toScVal(),
    usdcAsset(),
  ], userAddress);
  // Option::None from the contract → account not created yet → zeroed.
  if (raw === null || raw === undefined) {
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
    active_tasks_count: Number(raw.active_tasks_count),
  };
}

export async function buildDepositXdr(userAddress: string, amount: number): Promise<string> {
  return buildUnsignedXdr(userAddress, 'deposit', [
    new Address(userAddress).toScVal(),
    usdcAsset(),
    nativeToScVal(usdcToStroops(amount), { type: 'i128' }),
  ]);
}

export async function buildWithdrawXdr(userAddress: string, amount: number): Promise<string> {
  return buildUnsignedXdr(userAddress, 'withdraw', [
    new Address(userAddress).toScVal(),
    usdcAsset(),
    nativeToScVal(usdcToStroops(amount), { type: 'i128' }),
  ]);
}

export async function submitVaultXdr(
  signedXdr: string,
  _meta?: { user_address: string; tx_type: 'deposit' | 'withdrawal'; amount: number },
): Promise<string> {
  const s = server();
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const resp = await s.sendTransaction(tx);
  if (resp.status === 'ERROR') {
    throw new Error('Transaction submission failed');
  }
  return pollForConfirmation(resp.hash);
}

export async function buildCancelTaskXdr(
  userAddress: string,
  vaultTaskId: number,
): Promise<string> {
  return buildUnsignedXdr(userAddress, 'cancel_task', [
    new Address(userAddress).toScVal(),
    nativeToScVal(BigInt(vaultTaskId), { type: 'u64' }),
  ]);
}

export interface UserConfig {
  orchestrator: string | null;
  orchestrator_name: string;
  active_tasks_count: number;
}

/**
 * Read a wallet's vault config to see whether it already has an orchestrator
 * registered on-chain. Returns null if the wallet has no vault config yet.
 */
export async function fetchUserConfig(userAddress: string): Promise<UserConfig | null> {
  const raw = await callView('get_user_config', [new Address(userAddress).toScVal()], userAddress);
  if (raw === null || raw === undefined) return null;
  return {
    orchestrator: raw.orchestrator ?? null,
    orchestrator_name: raw.orchestrator_name ?? '',
    active_tasks_count: Number(raw.active_tasks_count ?? 0),
  };
}

/** Build an unsigned register_orchestrator XDR for the user to sign. */
export async function buildRegisterOrchestratorXdr(
  userAddress: string,
  orchestratorAddress: string,
  name: string,
): Promise<string> {
  return buildUnsignedXdr(userAddress, 'register_orchestrator', [
    new Address(userAddress).toScVal(),
    new Address(orchestratorAddress).toScVal(),
    nativeToScVal(name, { type: 'string' }),
  ]);
}
