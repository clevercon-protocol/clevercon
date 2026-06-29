/**
 * @integration — CleverVault orchestrator client integration tests.
 *
 * Runs against Soroban testnet with a deployed AgentVault contract.
 * Excluded from default `npm test`; run via `npm run test:integration`.
 *
 * Required env vars:
 *   AGENT_VAULT_CONTRACT_ID — deployed contract address
 *   STELLAR_RPC_URL         — Soroban RPC endpoint (default: testnet)
 *   USDC_SAC                — USDC Stellar Asset Contract address
 */

import { describe, it, expect, beforeAll } from 'vitest';
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

// ── Env ─────────────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.AGENT_VAULT_CONTRACT_ID ?? '';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const STROOPS_PER_USDC = 10_000_000;
const TIMEOUT = 30_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function rpcServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: false });
}

async function fundViaFriendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status} ${await res.text()}`);
  await new Promise((r) => setTimeout(r, 5000));
}

async function signAndSubmit(
  keypair: Keypair,
  method: string,
  args: xdr.ScVal[],
  txTimeout = 60,
): Promise<string> {
  const server = rpcServer();
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(txTimeout)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed [${method}]: ${simulated.error}`);
  }

  tx = SorobanRpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);

  const response = await server.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`Send failed [${method}]: ${JSON.stringify(response.errorResult)}`);
  }

  return pollForConfirmation(server, response.hash);
}

async function pollForConfirmation(server: SorobanRpc.Server, hash: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
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

async function callView(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = rpcServer();
  const dummy = Keypair.random();
  const contract = new Contract(CONTRACT_ID);

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

function usdcToScVal(amountUsdc: number): xdr.ScVal {
  return nativeToScVal(BigInt(Math.round(amountUsdc * STROOPS_PER_USDC)), { type: 'i128' });
}

async function getAvailable(userAddress: string): Promise<bigint> {
  const usdcSac = process.env.USDC_SAC ?? '';
  const args = usdcSac
    ? [new Address(userAddress).toScVal(), new Address(usdcSac).toScVal()]
    : [new Address(userAddress).toScVal()];
  const result = await callView('get_available', args);
  return result !== null ? BigInt(result as bigint | number) : 0n;
}

async function getBalance(userAddress: string): Promise<bigint> {
  const usdcSac = process.env.USDC_SAC ?? '';
  const args = usdcSac
    ? [new Address(userAddress).toScVal(), new Address(usdcSac).toScVal()]
    : [new Address(userAddress).toScVal()];
  const result = await callView('get_balance', args);
  return result !== null ? BigInt(result as bigint | number) : 0n;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!CONTRACT_ID)('vault-client integration @integration', () => {
  const usdcSac = process.env.USDC_SAC ?? '';
  let orchestratorKp: Keypair;

  beforeAll(async () => {
    orchestratorKp = Keypair.random();
    await fundViaFriendbot(orchestratorKp.publicKey());

    await signAndSubmit(orchestratorKp, 'register_orchestrator', [
      new Address(orchestratorKp.publicKey()).toScVal(),
      new Address(orchestratorKp.publicKey()).toScVal(),
      nativeToScVal('TestOrchestrator', { type: 'string' }),
    ]);
  }, TIMEOUT);

  // 1. Deposit ──────────────────────────────────────────────────────────────

  it(
    'deposit 1 USDC increases get_available by 1',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      const before = await getAvailable(user.publicKey());

      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(1),
      ]);

      const after = await getAvailable(user.publicKey());
      expect(after - before).toBe(BigInt(STROOPS_PER_USDC));
    },
    TIMEOUT,
  );

  // 2. Create task ──────────────────────────────────────────────────────────

  it(
    'create_task locks 0.1 USDC, get_available decreases',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      await signAndSubmit(user, 'register_orchestrator', [
        new Address(user.publicKey()).toScVal(),
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal('TaskOrch', { type: 'string' }),
      ]);

      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(1),
      ]);

      const before = await getAvailable(user.publicKey());

      await signAndSubmit(orchestratorKp, 'create_task', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.1),
      ]);

      const after = await getAvailable(user.publicKey());
      expect(before - after).toBe(BigInt(Math.round(0.1 * STROOPS_PER_USDC)));
    },
    TIMEOUT,
  );

  // 3. Release payment ──────────────────────────────────────────────────────

  it(
    'release_payment increases orchestrator balance',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      await signAndSubmit(user, 'register_orchestrator', [
        new Address(user.publicKey()).toScVal(),
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal('ReleaseOrch', { type: 'string' }),
      ]);

      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(1),
      ]);

      // Create task with 0.1 USDC
      await signAndSubmit(orchestratorKp, 'create_task', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.1),
      ]);

      const orchBefore = await getBalance(orchestratorKp.publicKey());

      // Release 0.05 USDC (task_id=1 for first task in this context)
      await signAndSubmit(orchestratorKp, 'release_payment', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal(1n, { type: 'u64' }),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.05),
      ]);

      const orchAfter = await getBalance(orchestratorKp.publicKey());
      expect(orchAfter - orchBefore).toBe(BigInt(Math.round(0.05 * STROOPS_PER_USDC)));
    },
    TIMEOUT,
  );

  // 4. Withdraw ─────────────────────────────────────────────────────────────

  it(
    'withdraw remaining balance leaves get_available at 0',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      await signAndSubmit(user, 'register_orchestrator', [
        new Address(user.publicKey()).toScVal(),
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal('WithdrawOrch', { type: 'string' }),
      ]);

      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(1),
      ]);

      // Create + complete a task
      await signAndSubmit(orchestratorKp, 'create_task', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.3),
      ]);

      await signAndSubmit(orchestratorKp, 'complete_task', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal(1n, { type: 'u64' }),
      ]);

      const available = await getAvailable(user.publicKey());
      expect(available).toBeGreaterThan(0n);

      await signAndSubmit(user, 'withdraw', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        nativeToScVal(available, { type: 'i128' }),
      ]);

      const after = await getAvailable(user.publicKey());
      expect(after).toBe(0n);
    },
    TIMEOUT,
  );

  // 5. Double release ───────────────────────────────────────────────────────

  it(
    'double release_payment on same task fails',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      await signAndSubmit(user, 'register_orchestrator', [
        new Address(user.publicKey()).toScVal(),
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal('DoubleOrch', { type: 'string' }),
      ]);

      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(1),
      ]);

      // Task with 0.05 budget
      await signAndSubmit(orchestratorKp, 'create_task', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.05),
      ]);

      // First release: 0.05 (full budget)
      await signAndSubmit(orchestratorKp, 'release_payment', [
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal(1n, { type: 'u64' }),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.05),
      ]);

      // Second release should fail (exceeds plan_cost)
      await expect(
        signAndSubmit(orchestratorKp, 'release_payment', [
          new Address(orchestratorKp.publicKey()).toScVal(),
          nativeToScVal(1n, { type: 'u64' }),
          new Address(usdcSac).toScVal(),
          usdcToScVal(0.01),
        ]),
      ).rejects.toThrow();
    },
    TIMEOUT,
  );

  // 6. Insufficient balance ─────────────────────────────────────────────────

  it(
    'create_task with more than available fails',
    async () => {
      const user = Keypair.random();
      await fundViaFriendbot(user.publicKey());

      await signAndSubmit(user, 'register_orchestrator', [
        new Address(user.publicKey()).toScVal(),
        new Address(orchestratorKp.publicKey()).toScVal(),
        nativeToScVal('InsufOrch', { type: 'string' }),
      ]);

      // Deposit only 0.01
      await signAndSubmit(user, 'deposit', [
        new Address(user.publicKey()).toScVal(),
        new Address(usdcSac).toScVal(),
        usdcToScVal(0.01),
      ]);

      // Try to create task for 100 USDC
      await expect(
        signAndSubmit(orchestratorKp, 'create_task', [
          new Address(orchestratorKp.publicKey()).toScVal(),
          new Address(usdcSac).toScVal(),
          usdcToScVal(100),
        ]),
      ).rejects.toThrow();
    },
    TIMEOUT,
  );
});
