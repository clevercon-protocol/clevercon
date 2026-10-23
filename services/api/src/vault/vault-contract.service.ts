import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  Account,
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
import { createRedisMutex, type RedisMutex } from './redis-mutex.js';
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
  private readonly resolverSecret: string;
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
    this.resolverSecret = config.get('DISPUTE_RESOLVER_SECRET', { infer: true }) ?? '';
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

  /**
   * Read the per-commitment R2/R7 accumulator (`get_commitment_accum`) that a
   * client must bind into a pp/2 batch proof BEFORE proving, so the proof matches
   * the window state the vault re-derives at settlement. Read-only: simulated with
   * a throwaway source (no funds/existence needed), nothing is submitted. Returns
   * the window spend/count + anchors as decimal strings for the prover.
   */
  async readCommitmentAccum(commitmentHex: string): Promise<{
    runningSpend: string;
    priorCount: string;
    anchorR2: string;
    anchorR7: string;
  }> {
    this.ensureActive();
    const server = this.server();
    const bytes = Buffer.from(commitmentHex.replace(/^0x/, ''), 'hex');
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(
        new Contract(this.contractId).call('get_commitment_accum', xdr.ScVal.scvBytes(bytes)),
      )
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) {
      throw new ServiceUnavailableException('Vault accumulator read failed');
    }
    const accum = scValToNative(sim.result.retval) as {
      anchor_r2: bigint | number;
      window_spent: bigint | number;
      anchor_r7: bigint | number;
      window_count: bigint | number;
    };
    return {
      runningSpend: String(accum.window_spent),
      priorCount: String(accum.window_count),
      anchorR2: String(accum.anchor_r2),
      anchorR7: String(accum.anchor_r7),
    };
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

  /** Unsigned `raise_dispute(user, task_id)` XDR; the buyer signs to freeze the task on-chain. */
  async buildRaiseDisputeXdr(userAddress: string, vaultTaskId: bigint): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'raise_dispute', [
      new Address(userAddress).toScVal(),
      nativeToScVal(vaultTaskId, { type: 'u64' }),
    ]);
  }

  /**
   * Resolve a disputed task on-chain, signed by the platform dispute-resolver key.
   * Splits the still-locked remainder (the vault enforces refund + payout ==
   * plan_cost - spent). Needs DISPUTE_RESOLVER_SECRET set here AND that key
   * registered on the vault via `set_dispute_resolver` by the admin.
   */
  async resolveDisputeOnChain(
    vaultTaskId: bigint,
    refundToUserUsdc: number,
    payoutToProviderUsdc: number,
  ): Promise<string> {
    this.ensureActive();
    if (!this.resolverSecret) {
      throw new ServiceUnavailableException('DISPUTE_RESOLVER_SECRET is not configured');
    }
    const kp = Keypair.fromSecret(this.resolverSecret);
    const unsigned = await this.buildUnsignedXdr(kp.publicKey(), 'resolve_dispute', [
      new Address(kp.publicKey()).toScVal(),
      nativeToScVal(vaultTaskId, { type: 'u64' }),
      nativeToScVal(usdcToStroops(refundToUserUsdc), { type: 'i128' }),
      nativeToScVal(usdcToStroops(payoutToProviderUsdc), { type: 'i128' }),
    ]);
    const tx = TransactionBuilder.fromXDR(unsigned, this.passphrase);
    tx.sign(kp);
    return this.submitSignedXdr(tx.toXDR());
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

  /**
   * Unsigned `set_policy_commitment(user, commitment)` XDR for the user to sign,
   * pinning a rule's 32-byte commitment to their account. The proof-gated
   * release path then accepts only releases whose commitment is in the user's
   * pinned set, so the operator cannot lock a task under a rule the user never
   * authorized. `commitmentHex` is 64 hex chars (validated at the controller).
   */
  async buildPinCommitmentXdr(userAddress: string, commitmentHex: string): Promise<string> {
    this.ensureActive();
    const bytes = Buffer.from(commitmentHex.replace(/^0x/, ''), 'hex');
    return this.buildUnsignedXdr(userAddress, 'set_policy_commitment', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(bytes),
    ]);
  }

  // ── Managed Sessions (server + public lane) ──
  // The server-held per-user delegate IS the managed session key. The owner
  // authorizes its on-chain scope ONCE (register_session, wallet-signed), the
  // server then signs each release with the delegate (release_payment_session),
  // and the vault enforces the budget + allowlist + expiry. Moving the limits
  // on-chain is what makes this safe where the old server-logic Autopay was not.

  /** Unsigned `register_session(user, session, usdc_sac, budget, expiry, allowlist)` XDR. */
  async buildRegisterSessionXdr(
    userAddress: string,
    sessionPublicKey: string,
    budgetUsdc: number,
    expiry: number,
    allowlist: string[],
  ): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'register_session', [
      new Address(userAddress).toScVal(),
      new Address(sessionPublicKey).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(usdcToStroops(budgetUsdc), { type: 'i128' }),
      nativeToScVal(BigInt(expiry), { type: 'u64' }),
      xdr.ScVal.scvVec(allowlist.map((a) => new Address(a).toScVal())),
    ]);
  }

  /** Unsigned `revoke_session(user, session)` XDR for the owner to sign. */
  async buildRevokeSessionXdr(userAddress: string, sessionPublicKey: string): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'revoke_session', [
      new Address(userAddress).toScVal(),
      new Address(sessionPublicKey).toScVal(),
    ]);
  }

  /**
   * Hands-off public-lane release: the server signs `release_payment_session` with
   * the user's delegate (which IS the registered session key), so no per-payment
   * wallet signature is needed. The vault enforces the on-chain scope and fails
   * closed off-allowlist / over-budget / past expiry. Returns the tx hash.
   */
  async releaseViaSession(delegate: Keypair, payee: string, amountUsdc: number): Promise<string> {
    this.ensureActive();
    const { hash } = await this.signAndSubmitAsOrchestrator(delegate, 'release_payment_session', [
      new Address(delegate.publicKey()).toScVal(),
      new Address(payee).toScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
    ]);
    return hash;
  }

  /**
   * Read a session's live on-chain scope (`get_session`). Returns null when no
   * session is registered for the key (SessionNotFound or revoked). Read-only
   * simulation with a throwaway source, nothing submitted.
   */
  async readSession(sessionPublicKey: string): Promise<{
    budgetRemainingUsdc: number;
    expiry: number;
    allowlist: string[];
    spentUsdc: number;
  } | null> {
    this.ensureActive();
    const server = this.server();
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(
        new Contract(this.contractId).call('get_session', new Address(sessionPublicKey).toScVal()),
      )
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) {
      return null; // no active session (SessionNotFound / revoked)
    }
    const s = scValToNative(sim.result.retval) as {
      budget_remaining: bigint | number;
      expiry: bigint | number;
      allowlist: string[];
      spent: bigint | number;
    };
    return {
      budgetRemainingUsdc: Number(s.budget_remaining) / STROOPS_PER_USDC,
      expiry: Number(s.expiry),
      allowlist: s.allowlist,
      spentUsdc: Number(s.spent) / STROOPS_PER_USDC,
    };
  }

  /**
   * Read a user's AUTHORITATIVE on-chain USDC position in the ACTIVE vault
   * (`get_account`). The Postgres mirror is keyed by (address, asset) not by vault
   * id, so after a vault cutover it can show a stale balance from a previous vault;
   * the headline balance must come from here. Returns null when the user has no
   * account in this vault. Read-only simulate, nothing submitted.
   */
  async readUserAccount(address: string): Promise<{
    balance: number;
    locked: number;
    available: number;
    totalDeposited: number;
    totalSpent: number;
  } | null> {
    this.ensureActive();
    const server = this.server();
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(
        new Contract(this.contractId).call(
          'get_account',
          new Address(address).toScVal(),
          this.usdcSacScVal(),
        ),
      )
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
    const acct = scValToNative(sim.result.retval) as null | {
      balance: bigint | number;
      locked: bigint | number;
      total_deposited: bigint | number;
      total_spent: bigint | number;
    };
    if (!acct) return null;
    const toUsdc = (v: bigint | number) => Number(v) / STROOPS_PER_USDC;
    const balance = toUsdc(acct.balance);
    const locked = toUsdc(acct.locked);
    return {
      balance,
      locked,
      available: balance - locked,
      totalDeposited: toUsdc(acct.total_deposited),
      totalSpent: toUsdc(acct.total_spent),
    };
  }

  /** Unsigned `unpin_policy_commitment(user, commitment)` XDR for the user to sign. */
  async buildUnpinCommitmentXdr(userAddress: string, commitmentHex: string): Promise<string> {
    this.ensureActive();
    const bytes = Buffer.from(commitmentHex.replace(/^0x/, ''), 'hex');
    return this.buildUnsignedXdr(userAddress, 'unpin_policy_commitment', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(bytes),
    ]);
  }

  /**
   * Read the user's bounded set of pinned policy commitments (`get_policy_commitments`)
   * as hex strings, so the dapp can show which saved rules are actually pinned
   * on-chain (and thus usable). Read-only simulate.
   */
  async readPolicyCommitments(userAddress: string): Promise<string[]> {
    this.ensureActive();
    const server = this.server();
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(
        new Contract(this.contractId).call(
          'get_policy_commitments',
          new Address(userAddress).toScVal(),
        ),
      )
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) return [];
    const arr = scValToNative(sim.result.retval) as Array<Buffer | Uint8Array>;
    return arr.map((b) => Buffer.from(b).toString('hex'));
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
  private readonly delegateLocks = new Map<string, Promise<unknown>>();
  private redisMutex: RedisMutex | null = null;

  /**
   * Cross-process lock so this API's delegate submit does not race the settlement
   * worker's release/finalize for the same signer. Gated on REDIS_URL; falls back
   * to in-process-only when Redis is not configured.
   */
  private lock(): RedisMutex {
    if (this.redisMutex) return this.redisMutex;
    const url = process.env.REDIS_URL;
    this.redisMutex = url
      ? createRedisMutex(
          new Redis(url, { maxRetriesPerRequest: null }) as unknown as Parameters<
            typeof createRedisMutex
          >[0],
        )
      : { withLock: (_key, fn) => fn() };
    return this.redisMutex;
  }

  /**
   * Serialize all delegate-signed submits per signer: in-process (two concurrent
   * requests, e.g. two /payments at once) AND cross-process (the settlement
   * worker uses the same signer). getAccount reflects the ledger-confirmed
   * sequence, so a retry alone can't outrun ledger close; the holder must finish
   * before the next submit builds. submitDelegateTx also retries txBadSeq as a
   * final safety net.
   */
  private signAndSubmitAsOrchestrator(
    kp: Keypair,
    method: string,
    args: xdr.ScVal[],
  ): Promise<{ hash: string; returnValue: unknown }> {
    const key = kp.publicKey();
    const submit = () => this.lock().withLock(key, () => this.submitDelegateTx(kp, method, args));
    const prev = this.delegateLocks.get(key) ?? Promise.resolve();
    const run = prev.then(submit, submit);
    this.delegateLocks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async submitDelegateTx(
    kp: Keypair,
    method: string,
    args: xdr.ScVal[],
  ): Promise<{ hash: string; returnValue: unknown }> {
    const server = this.server();
    const contract = new Contract(this.contractId);
    // The delegate key is also used by the settlement worker (releases/finalize).
    // If the two momentarily pick the same sequence number, the submit is rejected
    // with txBadSeq; refetch the account and rebuild with a fresh sequence.
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 4; attempt++) {
      const account = await server.getAccount(kp.publicKey());
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.passphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(120)
        .build();
      const simulated = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(simulated)) {
        throw new ServiceUnavailableException(`${method} simulation failed: ${simulated.error}`);
      }
      const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
      prepared.sign(kp);
      const response = await server.sendTransaction(prepared);
      if (response.status === 'ERROR') {
        let reason = 'rejected';
        try {
          reason = response.errorResult?.result().switch().name ?? reason;
        } catch {
          // keep the generic reason
        }
        lastErr = reason;
        if (reason === 'txBadSeq') {
          await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
          continue;
        }
        throw new ServiceUnavailableException(`${method} rejected on submit: ${reason}`);
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
    throw new ServiceUnavailableException(`${method} failed after retries: ${lastErr}`);
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

  /**
   * Claim all accrued USDC fees to the configured recipient (admin). The vault's
   * claim_fees requires the recipient to authorize, so this succeeds when the fee
   * recipient is the orchestrator/admin key (the recommended setup); otherwise the
   * recipient claims from their own wallet. Returns the tx hash and amount (USDC).
   */
  async claimFees(): Promise<{ txHash: string; claimedUsdc: number }> {
    if (!this.feeAdminEnabled) {
      throw new ServiceUnavailableException('VAULT_ADMIN_KEY not configured');
    }
    const { recipient } = await this.getFee();
    if (!recipient) {
      throw new ServiceUnavailableException('No fee recipient configured on the vault');
    }
    const claimedUsdc = await this.getAccruedFeesUsdc();
    const kp = Keypair.fromSecret(this.adminKey);
    const { hash } = await this.signAndSubmitAsOrchestrator(kp, 'claim_fees', [
      new Address(recipient).toScVal(),
      this.usdcSacScVal(),
    ]);
    return { txHash: hash, claimedUsdc };
  }
}
