import 'dotenv/config';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Horizon,
  rpc as SorobanRpc,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import {
  buildDepositXdr,
  buildRegisterOrchestratorXdr,
  buildWithdrawXdr,
  completeTask,
  createTask,
  getAccount,
  getAvailable,
  releasePayment,
  submitSignedXdr,
} from '../agent-vault-client.js';

const NETWORK_PASSPHRASE = Networks.TESTNET;
const STROOPS_PER_USDC = 10_000_000n;
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const AGENT_VAULT_CONTRACT_ID = process.env.AGENT_VAULT_CONTRACT_ID ?? '';
const ORCHESTRATOR_SECRET_KEY = process.env.ORCHESTRATOR_SECRET_KEY;
const VAULT_ACTIVE = AGENT_VAULT_CONTRACT_ID.length > 10 && !AGENT_VAULT_CONTRACT_ID.startsWith('C...');

const describeIf = VAULT_ACTIVE && ORCHESTRATOR_SECRET_KEY ? describe : describe.skip;

function horizonServer() {
  return new Horizon.Server(HORIZON_URL);
}

function sorobanServer() {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: false });
}

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * Number(STROOPS_PER_USDC)));
}

function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / Number(STROOPS_PER_USDC);
}

async function pollForConfirmation(server: SorobanRpc.Server, hash: string): Promise<string> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

async function signAndSubmitUserXdr(keypair: Keypair, unsignedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE);
  tx.sign(keypair);
  return submitSignedXdr(tx.toXDR());
}

async function fundFriendbot(publicKey: string): Promise<void> {
  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    throw new Error(`Friendbot failed: ${await response.text()}`);
  }
}

async function addUsdcTrustline(keypair: Keypair): Promise<void> {
  const server = horizonServer();
  const account = await server.loadAccount(keypair.publicKey());
  const existing = account.balances.find(
    (balance: any) => balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER,
  );
  if (existing) {
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  await server.submitTransaction(tx);
}

async function sendUsdcFromFundedOrchestrator(destination: string, amount: string): Promise<void> {
  if (!ORCHESTRATOR_SECRET_KEY) {
    throw new Error('Missing ORCHESTRATOR_SECRET_KEY for USDC funding');
  }

  const source = Keypair.fromSecret(ORCHESTRATOR_SECRET_KEY);
  const server = horizonServer();
  const account = await server.loadAccount(source.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: USDC,
        amount,
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(source);
  await server.submitTransaction(tx);
}

async function getUsdcBalance(publicKey: string): Promise<number> {
  const server = horizonServer();
  const account = await server.loadAccount(publicKey);
  const balance = account.balances.find(
    (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  return parseFloat(balance?.balance ?? '0');
}

async function getTaskInfo(taskId: bigint) {
  const server = sorobanServer();
  const contract = new Contract(AGENT_VAULT_CONTRACT_ID);
  const dummy = Keypair.random();
  const tx = new TransactionBuilder(
    {
      accountId: () => dummy.publicKey(),
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    } as any,
    {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    },
  )
    .addOperation(contract.call('get_task', nativeToScVal(taskId, { type: 'u64' })))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) return null;
  if (!('result' in simulated) || !simulated.result) return null;
  return scValToNative(simulated.result.retval);
}

async function createFreshVaultParticipants() {
  const user = Keypair.random();
  const orchestrator = Keypair.random();

  await fundFriendbot(user.publicKey());
  await fundFriendbot(orchestrator.publicKey());
  await addUsdcTrustline(user);
  await addUsdcTrustline(orchestrator);
  await sendUsdcFromFundedOrchestrator(user.publicKey(), '2');

  return { user, orchestrator };
}

async function registerOrchestrator(user: Keypair, orchestrator: Keypair): Promise<void> {
  const unsignedXdr = await buildRegisterOrchestratorXdr(
    user.publicKey(),
    orchestrator.publicKey(),
    'vitest-orchestrator',
  );
  if (!unsignedXdr) {
    throw new Error('AGENT_VAULT_CONTRACT_ID is not configured for register_orchestrator');
  }
  await signAndSubmitUserXdr(user, unsignedXdr);
}

async function depositToVault(user: Keypair, amountUsdc: number): Promise<void> {
  const unsignedXdr = await buildDepositXdr(user.publicKey(), amountUsdc);
  if (!unsignedXdr) {
    throw new Error('AGENT_VAULT_CONTRACT_ID is not configured for deposit');
  }
  await signAndSubmitUserXdr(user, unsignedXdr);
}

async function withdrawFromVault(user: Keypair, amountUsdc: number): Promise<void> {
  const unsignedXdr = await buildWithdrawXdr(user.publicKey(), amountUsdc);
  if (!unsignedXdr) {
    throw new Error('AGENT_VAULT_CONTRACT_ID is not configured for withdraw');
  }
  await signAndSubmitUserXdr(user, unsignedXdr);
}

async function releasePaymentDirect(orchestrator: Keypair, taskId: bigint, amountUsdc: number): Promise<string> {
  const server = sorobanServer();
  const account = await server.getAccount(orchestrator.publicKey());
  const contract = new Contract(AGENT_VAULT_CONTRACT_ID);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'release_payment',
        new Address(orchestrator.publicKey()).toScVal(),
        nativeToScVal(taskId, { type: 'u64' }),
        nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
      ),
    )
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  tx = SorobanRpc.assembleTransaction(tx, simulated).build();
  tx.sign(orchestrator);

  const response = await server.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(response.errorResult)}`);
  }

  return pollForConfirmation(server, response.hash);
}

const AVAILABLE_ONE_USDC = usdcToStroops(1);
const AVAILABLE_TENTH_USDC = usdcToStroops(0.1);
const AVAILABLE_FIFTY_MILLIS_USDC = usdcToStroops(0.05);

describeIf('Vault client integration', () => {
  beforeAll(() => {
    vi.setTimeout(30000);
  });

  it.concurrent('@integration Deposit increases available by 1 USDC', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);

    const before = await getAvailable(user.publicKey());
    expect(before).toBe(0n);

    await depositToVault(user, 1);

    const after = await getAvailable(user.publicKey());
    expect(after).toBe(AVAILABLE_ONE_USDC);
  });

  it.concurrent('@integration Create task decreases available and get_task returns the task', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);
    await depositToVault(user, 1);

    const before = await getAvailable(user.publicKey());
    expect(before).toBe(AVAILABLE_ONE_USDC);

    const taskId = await createTask(orchestrator, 0.1);
    expect(taskId).not.toBeNull();

    const after = await getAvailable(user.publicKey());
    expect(after).toBe(AVAILABLE_ONE_USDC - AVAILABLE_TENTH_USDC);

    const task = await getTaskInfo(taskId!);
    expect(task).not.toBeNull();
    expect(task.task_id ?? task.taskId ?? task.id ?? null).not.toBeNull();
    expect(task.plan_cost).toBe(AVAILABLE_TENTH_USDC);
    expect(task.spent).toBe(0n);
    expect(task.completed).toBe(false);
  });

  it.concurrent('@integration Release payment increases orchestrator USDC balance', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);
    await depositToVault(user, 1);

    const taskId = await createTask(orchestrator, 0.1);
    expect(taskId).not.toBeNull();

    const beforeBalance = await getUsdcBalance(orchestrator.publicKey());
    const hash = await releasePayment(orchestrator, taskId!, 0.05);
    expect(hash).not.toBeNull();

    const afterBalance = await getUsdcBalance(orchestrator.publicKey());
    expect(afterBalance).toBeGreaterThan(beforeBalance);
    expect(afterBalance - beforeBalance).toBeCloseTo(0.05, 4);
  });

  it.concurrent('@integration Withdraw remaining balance leaves available at 0', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);
    await depositToVault(user, 1);

    const taskId = await createTask(orchestrator, 0.1);
    expect(taskId).not.toBeNull();

    await releasePayment(orchestrator, taskId!, 0.05);
    await completeTask(orchestrator, taskId!);

    const account = await getAccount(user.publicKey());
    expect(account).not.toBeNull();
    expect(account?.available).toBeCloseTo(0.95, 4);

    await withdrawFromVault(user, 0.95);
    const afterAvailable = await getAvailable(user.publicKey());
    expect(afterAvailable).toBe(0n);
  });

  it.concurrent('@integration Double release on completed task fails', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);
    await depositToVault(user, 1);

    const taskId = await createTask(orchestrator, 0.1);
    expect(taskId).not.toBeNull();

    await releasePayment(orchestrator, taskId!, 0.05);
    await completeTask(orchestrator, taskId!);

    await expect(async () => {
      await releasePaymentDirect(orchestrator, taskId!, 0.01);
    }).rejects.toThrow(/Task already completed/);
  });

  it.concurrent('@integration Creating a task with insufficient available balance fails', { tags: ['integration'] }, async () => {
    const { user, orchestrator } = await createFreshVaultParticipants();
    await registerOrchestrator(user, orchestrator);
    await depositToVault(user, 1);

    const taskId = await createTask(orchestrator, 2);
    expect(taskId).toBeNull();
  });
});
