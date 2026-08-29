/**
 * CleverVault Soroban contract client.
 *
 * Wraps every CleverVault entrypoint with typed inputs, decoded native
 * TypeScript return values, and structured errors. Never exposes raw ScVal
 * to callers.
 *
 * Two invocation modes:
 * - **simulate** — read-only views (get_balance, get_account, etc.)
 * - **sign+submit** — state-changing calls (deposit, withdraw, create_task, etc.)
 *   returns an unsigned XDR string for the caller to sign in Freighter, OR
 *   signs+submits with a provided Keypair.
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
import {
  VaultContractError,
  errorFromSimulation,
  errorFromSendResponse,
  errorFromFailedTransaction,
} from './errors.js';
import type {
  VaultSDKConfig,
  UserAccount,
  TaskInfo,
  TaskStatus,
  FeeConfig,
} from './types.js';

const STROOPS_PER_USDC = 10_000_000n;

export class VaultClient {
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;
  private readonly usdcSac: string;
  private readonly _mock: boolean;

  constructor(config: VaultSDKConfig) {
    this.contractId = config.contractId;
    this.rpcUrl = config.rpcUrl ?? 'https://soroban-testnet.stellar.org';
    this.networkPassphrase =
      config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    this.usdcSac = config.usdcSac ?? '';
    this._mock = config.mock ?? false;
  }

  /** Whether this client is in mock mode. */
  get mock(): boolean {
    return this._mock;
  }

  /** Whether the vault contract is configured (non-placeholder ID). */
  get active(): boolean {
    return this.contractId.length > 10 && !this.contractId.startsWith('C...');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private rpc(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl, { allowHttp: false });
  }

  private requireUsdcSac(): string {
    if (!this.usdcSac) {
      throw new Error('USDC_SAC is required for CleverVault multi-asset calls');
    }
    return this.usdcSac;
  }

  private usdcSacScVal(): xdr.ScVal {
    return new Address(this.requireUsdcSac()).toScVal();
  }

  /** Build + simulate a contract call, returning the assembled unsigned XDR. */
  async buildUnsignedXdr(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    const server = this.rpc();
    const account = await server.getAccount(sourceAddress);
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw errorFromSimulation(simulated);
    }

    return SorobanRpc.assembleTransaction(tx, simulated).build().toXDR();
  }

  /** Sign + submit with a server-side keypair. Returns tx hash after confirmation. */
  async signAndSubmit(keypair: Keypair, method: string, args: xdr.ScVal[]): Promise<string> {
    const server = this.rpc();
    const account = await server.getAccount(keypair.publicKey());
    const contract = new Contract(this.contractId);

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw errorFromSimulation(simulated);
    }

    tx = SorobanRpc.assembleTransaction(tx, simulated).build();
    tx.sign(keypair);

    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw errorFromSendResponse(response);
    }

    return this.pollForConfirmation(server, response.hash);
  }

  /** Sign + submit and return the decoded return value (for calls that return data). */
  async signAndSubmitWithResult<T>(
    keypair: Keypair,
    method: string,
    args: xdr.ScVal[],
  ): Promise<T> {
    const server = this.rpc();
    const account = await server.getAccount(keypair.publicKey());
    const contract = new Contract(this.contractId);

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw errorFromSimulation(simulated);
    }

    tx = SorobanRpc.assembleTransaction(tx, simulated).build();
    tx.sign(keypair);

    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw errorFromSendResponse(response);
    }

    await this.pollForConfirmation(server, response.hash);

    const result = await server.getTransaction(response.hash);
    if (
      result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
      result.returnValue
    ) {
      return scValToNative(result.returnValue) as T;
    }
    throw new Error(`Transaction succeeded but no return value: ${response.hash}`);
  }

  private async pollForConfirmation(
    server: SorobanRpc.Server,
    hash: string,
  ): Promise<string> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return hash;
      }
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw errorFromFailedTransaction(hash, result);
      }
    }
    throw new Error(`Transaction timed out: ${hash}`);
  }

  /** Submit a pre-signed XDR (signed by user in Freighter). */
  async submitSignedXdr(signedXdr: string): Promise<string> {
    const server = this.rpc();
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      throw errorFromSendResponse(response);
    }
    return this.pollForConfirmation(server, response.hash);
  }

  /** Read-only view call — simulate only, no signing. */
  async callView(method: string, args: xdr.ScVal[]): Promise<any> {
    const server = this.rpc();
    const dummy = Keypair.random();
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(
      {
        accountId: () => dummy.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      } as any,
      { fee: BASE_FEE, networkPassphrase: this.networkPassphrase },
    )
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) return null;
    if (!('result' in simulated) || !simulated.result) return null;
    return scValToNative(simulated.result.retval);
  }

  // ── Conversion helpers ────────────────────────────────────────────────────

  static usdcToStroops(usdc: number): bigint {
    return BigInt(Math.round(usdc * Number(STROOPS_PER_USDC)));
  }

  static stroopsToUsdc(stroops: bigint | number): number {
    return Number(stroops) / Number(STROOPS_PER_USDC);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── State-changing calls (user-signed via Freighter) ────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Build unsigned `deposit` XDR for the user to sign in Freighter.
   */
  async buildDepositXdr(userAddress: string, amountUsdc: number): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'deposit', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(VaultClient.usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /**
   * Build unsigned `withdraw` XDR for the user to sign in Freighter.
   */
  async buildWithdrawXdr(userAddress: string, amountUsdc: number): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'withdraw', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(VaultClient.usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /**
   * Build unsigned `register_orchestrator` XDR.
   */
  async buildRegisterOrchestratorXdr(
    userAddress: string,
    orchestratorAddress: string,
    name: string,
  ): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'register_orchestrator', [
      new Address(userAddress).toScVal(),
      new Address(orchestratorAddress).toScVal(),
      nativeToScVal(name, { type: 'string' }),
    ]);
  }

  /**
   * Build unsigned `update_orchestrator` XDR for the user to sign.
   */
  async buildUpdateOrchestratorXdr(
    userAddress: string,
    newOrchestratorAddress: string,
    name: string,
  ): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'update_orchestrator', [
      new Address(userAddress).toScVal(),
      new Address(newOrchestratorAddress).toScVal(),
      nativeToScVal(name, { type: 'string' }),
    ]);
  }

  /**
   * Build unsigned `cancel_task` XDR for the user to sign.
   */
  async buildCancelTaskXdr(userAddress: string, taskId: bigint): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'cancel_task', [
      new Address(userAddress).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
  }

  /**
   * Build unsigned `raise_dispute` XDR for the user to sign.
   */
  async buildRaiseDisputeXdr(userAddress: string, taskId: bigint): Promise<string> {
    return this.buildUnsignedXdr(userAddress, 'raise_dispute', [
      new Address(userAddress).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
  }

  /**
   * Build unsigned `claim_fees` XDR for the fee recipient to sign.
   */
  async buildClaimFeesXdr(recipientAddress: string, assetAddress: string): Promise<string> {
    return this.buildUnsignedXdr(recipientAddress, 'claim_fees', [
      new Address(recipientAddress).toScVal(),
      new Address(assetAddress).toScVal(),
    ]);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── State-changing calls (orchestrator-signed server-side) ──────────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a new on-chain task. Returns the new task_id.
   */
  async createTask(
    orchestratorKeypair: Keypair,
    planCostUsdc: number,
  ): Promise<bigint> {
    return this.signAndSubmitWithResult<bigint>(
      orchestratorKeypair,
      'create_task',
      [
        new Address(orchestratorKeypair.publicKey()).toScVal(),
        this.usdcSacScVal(),
        nativeToScVal(VaultClient.usdcToStroops(planCostUsdc), { type: 'i128' }),
      ],
    );
  }

  /**
   * Release funds for one step. Returns the tx hash.
   */
  async releasePayment(
    orchestratorKeypair: Keypair,
    taskId: bigint,
    stepId: bigint,
    amountUsdc: number,
  ): Promise<string> {
    return this.signAndSubmit(orchestratorKeypair, 'release_payment', [
      new Address(orchestratorKeypair.publicKey()).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
      nativeToScVal(stepId, { type: 'u64' }),
      this.usdcSacScVal(),
      nativeToScVal(VaultClient.usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /**
   * Mark a task as complete. Returns the tx hash.
   */
  async completeTask(orchestratorKeypair: Keypair, taskId: bigint): Promise<string> {
    return this.signAndSubmit(orchestratorKeypair, 'complete_task', [
      new Address(orchestratorKeypair.publicKey()).toScVal(),
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
  }

  /**
   * Force-complete a stale task (anyone can call).
   */
  async forceCompleteStaleTask(taskId: bigint): Promise<string> {
    const dummy = Keypair.random();
    return this.signAndSubmit(dummy, 'force_complete_stale_task', [
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── Read-only views ────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  /** Total balance (available + locked) in stroops. */
  async getBalance(userAddress: string): Promise<bigint> {
    const result = await this.callView('get_balance', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
    ]);
    return result !== null ? BigInt(result) : 0n;
  }

  /** Available (unlocked) balance in stroops. */
  async getAvailable(userAddress: string): Promise<bigint> {
    const result = await this.callView('get_available', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
    ]);
    return result !== null ? BigInt(result) : 0n;
  }

  /**
   * Full user account record.
   * Returns null if user has no on-chain account yet.
   */
  async getAccount(userAddress: string): Promise<UserAccount | null> {
    const raw = await this.callView('get_account', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
    ]);
    if (raw === null || raw === undefined) return null;
    return {
      balance: BigInt(raw.balance),
      locked: BigInt(raw.locked),
      total_deposited: BigInt(raw.total_deposited),
      total_spent: BigInt(raw.total_spent),
      active_tasks_count: Number(raw.active_tasks_count),
      orchestrator: raw.orchestrator ?? null,
      orchestrator_name: String(raw.orchestrator_name ?? ''),
      created_at: BigInt(raw.created_at),
    };
  }

  /** User config (orchestrator registration, active tasks). */
  async getUserConfig(userAddress: string): Promise<import('./types.js').UserConfig | null> {
    const raw = await this.callView('get_user_config', [
      new Address(userAddress).toScVal(),
    ]);
    if (raw === null || raw === undefined) return null;
    return {
      orchestrator: raw.orchestrator ?? null,
      orchestrator_name: String(raw.orchestrator_name ?? ''),
      active_tasks_count: Number(raw.active_tasks_count),
      created_at: BigInt(raw.created_at),
    };
  }

  /** Full task record by task_id. */
  async getTask(taskId: bigint): Promise<TaskInfo | null> {
    const raw = await this.callView('get_task', [
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
    if (raw === null || raw === undefined) return null;
    return {
      user: String(raw.user),
      orchestrator: String(raw.orchestrator),
      asset: String(raw.asset),
      plan_cost: BigInt(raw.plan_cost),
      spent: BigInt(raw.spent),
      completed: Boolean(raw.completed),
      disputed: Boolean(raw.disputed),
      created_at: BigInt(raw.created_at),
    };
  }

  /** Task lifecycle status. */
  async getTaskStatus(taskId: bigint): Promise<TaskStatus | null> {
    const raw = await this.callView('get_task_status', [
      nativeToScVal(taskId, { type: 'u64' }),
    ]);
    if (raw === null || raw === undefined) return null;
    // Soroban enum variants come back as the variant name string
    return String(raw) as TaskStatus;
  }

  /** List of a user's task IDs. */
  async getUserTasks(userAddress: string): Promise<bigint[]> {
    const raw = await this.callView('get_user_tasks', [
      new Address(userAddress).toScVal(),
    ]);
    if (!raw) return [];
    return Array.from(raw).map((id: any) => BigInt(id));
  }

  /** Reverse lookup: orchestrator address → user address. */
  async getOrchestratorOwner(orchestratorAddress: string): Promise<string | null> {
    const raw = await this.callView('get_orchestrator_owner', [
      new Address(orchestratorAddress).toScVal(),
    ]);
    return raw ? String(raw) : null;
  }

  /** Whether an asset is whitelisted. */
  async isSupportedAsset(assetAddress: string): Promise<boolean> {
    const raw = await this.callView('is_supported_asset', [
      new Address(assetAddress).toScVal(),
    ]);
    return Boolean(raw);
  }

  /** List of all whitelisted assets. */
  async getSupportedAssets(): Promise<string[]> {
    const raw = await this.callView('get_supported_assets', []);
    if (!raw) return [];
    return Array.from(raw).map((a: any) => String(a));
  }

  /** Total tasks ever created. */
  async taskCount(): Promise<bigint> {
    const raw = await this.callView('task_count', []);
    return raw !== null ? BigInt(raw) : 0n;
  }

  /** Contract version. */
  async version(): Promise<number> {
    const raw = await this.callView('version', []);
    return Number(raw ?? 0);
  }

  /** Whether the contract is paused. */
  async isPaused(): Promise<boolean> {
    const raw = await this.callView('is_paused', []);
    return Boolean(raw);
  }

  /** Token balance held by the vault for an asset. */
  async tokenBalance(assetAddress: string): Promise<bigint> {
    const raw = await this.callView('token_balance', [
      new Address(assetAddress).toScVal(),
    ]);
    return raw !== null ? BigInt(raw) : 0n;
  }

  /** Current dispute resolver address. */
  async getDisputeResolver(): Promise<string | null> {
    const raw = await this.callView('get_dispute_resolver', []);
    return raw ? String(raw) : null;
  }

  /** Current stale task threshold in seconds. */
  async getStaleThreshold(): Promise<number> {
    const raw = await this.callView('get_stale_threshold', []);
    return Number(raw ?? 1800);
  }

  /** Current max active tasks per user. */
  async getMaxActiveTasks(): Promise<number> {
    const raw = await this.callView('get_max_active_tasks', []);
    return Number(raw ?? 50);
  }

  /** Fee config (bps, recipient). */
  async getFee(): Promise<FeeConfig> {
    const raw = await this.callView('get_fee', []);
    if (!raw) return { bps: 0, recipient: null };
    return {
      bps: Number(raw[0] ?? 0),
      recipient: raw[1] ? String(raw[1]) : null,
    };
  }

  /** Accrued but unclaimed fees for an asset. */
  async getAccruedFees(assetAddress: string): Promise<bigint> {
    const raw = await this.callView('get_accrued_fees', [
      new Address(assetAddress).toScVal(),
    ]);
    return raw !== null ? BigInt(raw) : 0n;
  }
}
