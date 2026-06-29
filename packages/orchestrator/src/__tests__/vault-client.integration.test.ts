/**
 * @integration — CleverVault Soroban contract integration tests.
 *
 * Runs against Stellar testnet. Requires:
 *   AGENT_VAULT_CONTRACT_ID  — deployed contract address
 *   USDC_SAC                 — USDC Stellar Asset Contract address on testnet
 *
 * Run:  npm run test:integration
 * Tag:  @integration (excluded from default `npm test`)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  xdr,
  Keypair,
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  Address,
} from '@stellar/stellar-sdk';

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = process.env.AGENT_VAULT_CONTRACT_ID;
const USDC_SAC = process.env.USDC_SAC;
const STROOPS_PER_USDC = 10_000_000;
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fund a fresh keypair on testnet via friendbot. */
async function fundAccount(keypair: Keypair): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${keypair.publicKey()}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status} ${await res.text()}`);
  // Wait for ledger confirmation
  await new Promise((r) => setTimeout(r, 5000));
}

/** Build, simulate, sign, submit, and poll a contract call. Returns tx hash. */
async function signAndSubmit(
  keypair: Keypair,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(CONTRACT_ID!);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(120)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed (${method}): ${simulated.error}`);
  }

  tx = SorobanRpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);

  const response = await server.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`Send failed (${method}): ${JSON.stringify(response.errorResult)}`);
  }

  return pollForConfirmation(response.hash);
}

/** Poll until transaction is confirmed or fails. */
async function pollForConfirmation(hash: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await server.getTransaction(hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

/** Read-only call via simulation (no auth needed). */
async function callView(method: string, args: xdr.ScVal[]): Promise<any> {
  const dummy = Keypair.random();
  const contract = new Contract(CONTRACT_ID!);

  const tx = new TransactionBuilder(
    {
      accountId: () => dummy.publicKey(),
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    } as any,
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

/** Get available (unlocked) balance in stroops. */
async function getAvailable(userAddr: string): Promise<bigint> {
  const result = await callView('get_available', [
    new Address(userAddr).toScVal(),
    new Address(USDC_SAC!).toScVal(),
  ]);
  return result !== null ? BigInt(result) : 0n;
}

/** Get total balance in stroops. */
async function getBalance(userAddr: string): Promise<bigint> {
  const result = await callView('get_balance', [
    new Address(userAddr).toScVal(),
    new Address(USDC_SAC!).toScVal(),
  ]);
  return result !== null ? BigInt(result) : 0n;
}

// ── Skip guard ────────────────────────────────────────────────────────────────

const SKIP = !CONTRACT_ID || !USDC_SAC;

const itIfDeployed = SKIP ? it.skip : it;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('@integration vault-client', () => {
  const userKeypair = Keypair.random();
  const orchKeypair = Keypair.random();

  beforeAll(async () => {
    if (SKIP) return;

    // Fund both accounts on testnet
    await fundAccount(userKeypair);
    await fundAccount(orchKeypair);

    // 1. Register orchestrator for user
    await signAndSubmit(userKeypair, 'register_orchestrator', [
      new Address(userKeypair.publicKey()).toScVal(),
      new Address(orchKeypair.publicKey()).toScVal(),
      nativeToScVal('TestOrch', { type: 'string' }),
    ]);
  }, 60_000);

  // ── Scenario 1: Deposit ──────────────────────────────────────────────

  itIfDeployed('deposit — increases available balance', async () => {
    // Approve contract to pull USDC from user via transfer
    // On testnet we need a trustline first; assume USDC SAC exists.
    // Deposit 1 USDC into vault
    await signAndSubmit(userKeypair, 'deposit', [
      new Address(userKeypair.publicKey()).toScVal(),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(1), { type: 'i128' }),
    ]);

    const available = await getAvailable(userKeypair.publicKey());
    expect(available).toBe(usdcToStroops(1));
  }, 30_000);

  // ── Scenario 2: Create task ──────────────────────────────────────────

  itIfDeployed('create task — decreases available, returns task id', async () => {
    const before = await getAvailable(userKeypair.publicKey());

    // Create task costing 0.1 USDC
    const taskId = await signAndSubmit(orchKeypair, 'create_task', [
      new Address(orchKeypair.publicKey()).toScVal(),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(0.1), { type: 'i128' }),
    ]);

    expect(taskId).toBeTruthy();

    const after = await getAvailable(userKeypair.publicKey());
    // Available should have decreased by 0.1 USDC
    expect(after).toBe(before - usdcToStroops(0.1));
  }, 30_000);

  // ── Scenario 3: Release payment ──────────────────────────────────────

  itIfDeployed('release payment — increases orchestrator balance', async () => {
    const orchBalanceBefore = await getBalance(orchKeypair.publicKey());

    // Release 0.05 USDC for task id 1
    await signAndSubmit(orchKeypair, 'release_payment', [
      new Address(orchKeypair.publicKey()).toScVal(),
      nativeToScVal(1n, { type: 'u64' }),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(0.05), { type: 'i128' }),
    ]);

    const orchBalanceAfter = await getBalance(orchKeypair.publicKey());
    expect(orchBalanceAfter).toBe(orchBalanceBefore + usdcToStroops(0.05));
  }, 30_000);

  // ── Scenario 4: Withdraw ─────────────────────────────────────────────

  itIfDeployed('withdraw — available goes to 0 after full withdrawal', async () => {
    // Complete task first to unlock remaining budget
    await signAndSubmit(orchKeypair, 'complete_task', [
      new Address(orchKeypair.publicKey()).toScVal(),
      nativeToScVal(1n, { type: 'u64' }),
    ]);

    // Remaining available = 1.0 - 0.05 (spent) = 0.95
    const available = await getAvailable(userKeypair.publicKey());
    expect(available).toBe(usdcToStroops(0.95));

    // Withdraw all
    await signAndSubmit(userKeypair, 'withdraw', [
      new Address(userKeypair.publicKey()).toScVal(),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(available, { type: 'i128' }),
    ]);

    const after = await getAvailable(userKeypair.publicKey());
    expect(after).toBe(0n);
  }, 30_000);

  // ── Scenario 5: Double release ───────────────────────────────────────

  itIfDeployed('double release — fails with TaskAlreadyCompleted', async () => {
    // Deposit and create a new task
    await signAndSubmit(userKeypair, 'deposit', [
      new Address(userKeypair.publicKey()).toScVal(),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(1), { type: 'i128' }),
    ]);

    await signAndSubmit(orchKeypair, 'create_task', [
      new Address(orchKeypair.publicKey()).toScVal(),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(0.1), { type: 'i128' }),
    ]);

    // Release payment and complete task (id 2)
    await signAndSubmit(orchKeypair, 'release_payment', [
      new Address(orchKeypair.publicKey()).toScVal(),
      nativeToScVal(2n, { type: 'u64' }),
      new Address(USDC_SAC!).toScVal(),
      nativeToScVal(usdcToStroops(0.05), { type: 'i128' }),
    ]);

    await signAndSubmit(orchKeypair, 'complete_task', [
      new Address(orchKeypair.publicKey()).toScVal(),
      nativeToScVal(2n, { type: 'u64' }),
    ]);

    // Attempt double release — should throw
    await expect(
      signAndSubmit(orchKeypair, 'release_payment', [
        new Address(orchKeypair.publicKey()).toScVal(),
        nativeToScVal(2n, { type: 'u64' }),
        new Address(USDC_SAC!).toScVal(),
        nativeToScVal(usdcToStroops(0.01), { type: 'i128' }),
      ]),
    ).rejects.toThrow();
  }, 30_000);

  // ── Scenario 6: Insufficient balance ─────────────────────────────────

  itIfDeployed('insufficient balance — create task fails', async () => {
    // Withdraw all remaining to ensure 0 available
    const avail = await getAvailable(userKeypair.publicKey());
    if (avail > 0n) {
      await signAndSubmit(userKeypair, 'withdraw', [
        new Address(userKeypair.publicKey()).toScVal(),
        new Address(USDC_SAC!).toScVal(),
        nativeToScVal(avail, { type: 'i128' }),
      ]);
    }

    // Try to create task with more than available
    await expect(
      signAndSubmit(orchKeypair, 'create_task', [
        new Address(orchKeypair.publicKey()).toScVal(),
        new Address(USDC_SAC!).toScVal(),
        nativeToScVal(usdcToStroops(100), { type: 'i128' }),
      ]),
    ).rejects.toThrow();
  }, 30_000);
});
