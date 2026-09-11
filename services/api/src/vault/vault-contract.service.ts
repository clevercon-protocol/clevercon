import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  scValToNative,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import type { AppEnv } from '../config/env.validation.js';

const STROOPS_PER_USDC = 10_000_000;

function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * STROOPS_PER_USDC));
}

/**
 * CleverVault (AgentVault) Soroban client for the API. Deposits and withdrawals
 * are user-custodied: the API builds an unsigned XDR that the caller signs in
 * their wallet, then the API submits it. On-chain is the source of truth; the
 * Postgres mirror is updated by the indexer from the resulting event.
 *
 * When the contract id is unset or a placeholder the client is inactive and
 * every mutating call raises ServiceUnavailable (never a silent no-op or a fake
 * success), so the UI can honestly say the vault is not enabled here.
 *
 * Ported from packages/orchestrator/src/agent-vault-client.ts.
 */
@Injectable()
export class VaultContractService {
  private readonly logger = new Logger(VaultContractService.name);
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly usdcSac: string;
  private readonly adminKey: string;
  readonly passphrase: string;
  readonly active: boolean;
  /** The deployed vault contract id, or '' when not configured. */
  get contractAddress(): string {
    return this.active ? this.contractId : '';
  }

  /** The configured USDC asset (SAC) the app denominates the vault in. */
  get usdcAsset(): string {
    return this.usdcSac;
  }

  constructor(config: ConfigService<AppEnv, true>) {
    this.contractId = config.get('AGENT_VAULT_CONTRACT_ID', { infer: true }) ?? '';
    this.rpcUrl = config.get('STELLAR_RPC_URL', { infer: true });
    this.usdcSac = config.get('USDC_SAC', { infer: true }) ?? '';
    this.adminKey = config.get('VAULT_ADMIN_KEY', { infer: true }) ?? '';
    this.passphrase = config.get('NETWORK_PASSPHRASE', { infer: true });
    this.active = this.contractId.length > 10 && !this.contractId.startsWith('C...');
    if (!this.active) {
      this.logger.warn('AGENT_VAULT_CONTRACT_ID not set; vault deposit/withdraw disabled');
    }
  }

  private server(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl, { allowHttp: false });
  }

  private ensureActive(): void {
    if (!this.active) {
      throw new ServiceUnavailableException('Vault is not configured in this environment');
    }
  }

  private usdcSacScVal(): xdr.ScVal {
    if (!this.usdcSac) {
      throw new ServiceUnavailableException('USDC_SAC is required for vault transfers');
    }
    return new Address(this.usdcSac).toScVal();
  }

  /** Build + simulate a call, returning the assembled unsigned XDR to sign. */
  private async buildUnsignedXdr(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    const server = this.server();
    const account = await server.getAccount(sourceAddress);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new ServiceUnavailableException(`Vault simulation failed: ${simulated.error}`);
    }
    return SorobanRpc.assembleTransaction(tx, simulated).build().toXDR();
  }

  /** Unsigned `deposit(user, usdc_sac, amount)` XDR for the user to sign. */
  async buildDepositXdr(userAddress: string, amountUsdc: number): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'deposit', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /** Unsigned `withdraw(user, usdc_sac, amount)` XDR; fails on-chain if over available. */
  async buildWithdrawXdr(userAddress: string, amountUsdc: number): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'withdraw', [
      new Address(userAddress).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
  }

  /** Submit a wallet-signed XDR and poll for confirmation; returns the tx hash. */
  async submitSignedXdr(signedXdr: string): Promise<string> {
    this.ensureActive();
    const server = this.server();
    const tx = TransactionBuilder.fromXDR(signedXdr, this.passphrase);
    const response = await server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      // Surface the actual reason (e.g. txBadSeq, txInsufficientBalance) so the
      // UI can tell the user why, instead of a generic failure.
      let reason = 'rejected';
      try {
        reason = response.errorResult?.result().switch().name ?? reason;
      } catch {
        // keep the generic reason
      }
      throw new ServiceUnavailableException(
        `Vault transaction rejected on submit: ${reason}. If it says txBadSeq, wait a few seconds and retry.`,
      );
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new ServiceUnavailableException(`Vault transaction failed: ${response.hash}`);
      }
    }
    throw new ServiceUnavailableException(`Vault transaction timed out: ${response.hash}`);
  }

  // ── Bounded-delegate actions (signed by the user's per-user delegate) ──
  // The delegate keypair is supplied by DelegateService per call; this client
  // holds no key. The delegate is bounded by the vault policy on every release.

  /**
   * Unsigned `register_orchestrator(user, orchestrator, name)` XDR for the user
   * to sign once, authorizing their delegate to lock/release within policy.
   * User-custodied: the user signs, the API submits.
   */
  async buildRegisterOrchestratorXdr(
    userAddress: string,
    orchestrator: string,
    name = 'clevercon',
  ): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'register_orchestrator', [
      new Address(userAddress).toScVal(),
      new Address(orchestrator).toScVal(),
      nativeToScVal(name, { type: 'string' }),
    ]);
  }

  /**
   * Sign a contract call with the given delegate keypair and submit it; returns
   * the tx hash and the decoded contract return value (e.g. the new task id).
   */
  private async signAndSubmitAsOrchestrator(
    kp: Keypair,
    method: string,
    args: xdr.ScVal[],
  ): Promise<{ hash: string; returnValue: unknown }> {
    const server = this.server();
    const account = await server.getAccount(kp.publicKey());
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build();
    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new ServiceUnavailableException(`${method} simulation failed: ${simulated.error}`);
    }
    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(kp);
    const response = await server.sendTransaction(prepared);
    if (response.status === 'ERROR') {
      throw new ServiceUnavailableException(`${method} rejected on submit`);
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await server.getTransaction(response.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        const returnValue = result.returnValue ? scValToNative(result.returnValue) : null;
        return { hash: response.hash, returnValue };
      }
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new ServiceUnavailableException(`${method} failed on-chain: ${response.hash}`);
      }
    }
    throw new ServiceUnavailableException(`${method} timed out: ${response.hash}`);
  }

  /**
   * Lock a task's budget on-chain as the delegate, binding a policy commitment.
   * Returns the on-chain task id. Signed by the platform delegate (the user must
   * have registered it first), bounded by the committed policy.
   */
  async createTaskWithPolicy(
    kp: Keypair,
    planCostUsdc: number,
    commitmentHex: string,
  ): Promise<bigint> {
    this.ensureActive();
    const commitment = Buffer.from(commitmentHex, 'hex');
    if (commitment.length !== 32)
      throw new ServiceUnavailableException('commitment must be 32 bytes');
    const { returnValue } = await this.signAndSubmitAsOrchestrator(kp, 'create_task_with_policy', [
      new Address(kp.publicKey()).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(planCostUsdc), { type: 'i128' }),
      nativeToScVal(commitment, { type: 'bytes' }),
    ]);
    return BigInt(returnValue as string | number | bigint);
  }

  /**
   * Settle one released step: the delegate submits `release_payment_proved` with
   * the binding proof. The vault calls the verifier and only moves funds on a
   * true verdict, so the delegate can never pay outside the policy.
   */
  async releasePaymentProved(
    kp: Keypair,
    params: {
      taskId: bigint;
      stepId: bigint;
      amountUsdc: number;
      payee: string;
      nullifierHex: string;
      proof: Buffer;
    },
  ): Promise<string> {
    this.ensureActive();
    const nullifier = Buffer.from(params.nullifierHex, 'hex');
    const { hash } = await this.signAndSubmitAsOrchestrator(kp, 'release_payment_proved', [
      new Address(kp.publicKey()).toScVal(),
      nativeToScVal(params.taskId, { type: 'u64' }),
      nativeToScVal(params.stepId, { type: 'u64' }),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(params.amountUsdc), { type: 'i128' }),
      new Address(params.payee).toScVal(),
      nativeToScVal(nullifier, { type: 'bytes' }),
      nativeToScVal(params.proof, { type: 'bytes' }),
    ]);
    return hash;
  }

  // ── Protocol fee administration (operator console) ──────────────────────────

  /** Whether fee admin is available (a vault admin key is configured). */
  get feeAdminEnabled(): boolean {
    return this.active && this.adminKey.length > 0;
  }

  /** Simulate a read-only call and return its decoded return value. */
  private async simulateRead(sourceAddress: string, method: string, args: xdr.ScVal[] = []) {
    const server = this.server();
    const account = await server.getAccount(sourceAddress);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new ServiceUnavailableException(`${method} read failed: ${sim.error}`);
    }
    const retval = sim.result?.retval;
    return retval ? scValToNative(retval) : null;
  }

  /** Current protocol fee: { bps, recipient } (recipient null if unset). */
  async getFee(): Promise<{ bps: number; recipient: string | null }> {
    this.ensureActive();
    const src = this.adminKey
      ? Keypair.fromSecret(this.adminKey).publicKey()
      : new Address(this.contractId).toString();
    const [bps, recipient] = (await this.simulateRead(src, 'get_fee')) as [number, string | null];
    return { bps: Number(bps), recipient: recipient ?? null };
  }

  /** Accrued (claimable) fees for the configured USDC asset, in USDC. */
  async getAccruedFeesUsdc(): Promise<number> {
    this.ensureActive();
    const src = Keypair.fromSecret(this.adminKey).publicKey();
    const stroops = (await this.simulateRead(src, 'get_accrued_fees', [this.usdcSacScVal()])) as
      | bigint
      | number;
    return Number(stroops) / STROOPS_PER_USDC;
  }

  /** Set the protocol fee (admin). bps is capped on-chain; recipient optional. */
  async setFee(bps: number, recipient?: string): Promise<string> {
    if (!this.feeAdminEnabled) {
      throw new ServiceUnavailableException('VAULT_ADMIN_KEY not configured');
    }
    const kp = Keypair.fromSecret(this.adminKey);
    // Option<Address>: Some(addr) is the Address ScVal, None is ScVal::Void.
    const recipientScVal = recipient ? new Address(recipient).toScVal() : nativeToScVal(null);
    const { hash } = await this.signAndSubmitAsOrchestrator(kp, 'set_fee', [
      new Address(kp.publicKey()).toScVal(),
      nativeToScVal(bps, { type: 'u32' }),
      recipientScVal,
    ]);
    return hash;
  }
}
