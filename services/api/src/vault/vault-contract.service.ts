import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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

/** Friendly messages for the vault's VaultError codes that a client can act on. */
const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  2: 'The vault is paused by the operator; try again shortly.',
  4: 'That action is not allowed for this account.',
  5: 'Not enough balance in your vault for this.',
  6: 'Not enough available balance (some is locked by active jobs).',
  11: 'Invalid amount.',
  17: 'That key is not the authorized orchestrator for this account.',
  29: 'The proof verifier is not configured on this network yet.',
  30: 'This spend needs a proof, which was not provided.',
  32: 'The vault rejected the proof: this payment does not satisfy your rule (check the amount and payee against the rule, and its rolling-cap / velocity window).',
  33: 'This exact payment was already settled (replay protection). Nothing was charged twice.',
  34: 'Malformed payment batch. Please try again.',
  35: 'Duplicate payment within the batch. Please try again.',
  36: 'The payment is outside its validity window (check your device clock), please try again.',
  37: 'You have pinned the maximum number of rules; unpin one first.',
  38: 'That rule is not pinned on-chain.',
  39: 'This rule is not pinned on-chain for your account, so it cannot authorize a spend. Pin it on the Rules tab, then try again.',
  40: 'The payment validity window is too long, please try again.',
  42: 'That session key is not registered (or was revoked).',
  43: 'This session key has expired. Create a new one (or extend it).',
  44: 'That payee is not on this rule’s approved list.',
  45: 'This payment would exceed the session key’s spend cap.',
  46: 'Only the owner can manage this session.',
  48: 'A global rule is set but its second proof is missing. Reload the app; if it persists, clear the global on the Rules tab.',
  49: 'Your global rule changed. Reload the app and try again.',
  50: 'That payee is blocked by your rule’s deny-list.',
  51: 'This payment exceeds the rule’s per-payment cap.',
  52: 'The session key has expired.',
  53: 'This session key is paused; unpause it on the Vault tab to spend again.',
  54: 'The public rule this key runs under no longer exists. Re-create it, or re-register the key.',
  55: 'This payment is below the rule’s per-payment minimum.',
  56: 'This payment would exceed the rule’s rolling cap for its window.',
  57: 'This payment would exceed the rule’s rate limit (too many in the window).',
  58: 'This payment is outside the rule’s allowed calendar window.',
  59: 'Invalid session or rule parameters (a server key needs a future expiry; caps cannot be negative).',
  60: 'A session key must have a spend cap and/or a rule; this one had neither.',
};

/**
 * Translate a raw Soroban `Error(Contract, #NN)` / HostError into a clean, actionable
 * message (a 400, not a 503 HostError dump) for the dapp and SDK/MCP. Also tidies the
 * common non-contract sequence error. Rethrows anything else unchanged.
 */
function mapContractError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/Error\(Contract,\s*#(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    throw new BadRequestException(
      CONTRACT_ERROR_MESSAGES[code] ?? `The vault rejected this (code #${code}).`,
    );
  }
  if (/txBadSeq/i.test(msg)) {
    throw new ServiceUnavailableException(
      'The network was busy (sequence conflict). Please try again in a moment.',
    );
  }
  throw err instanceof Error ? err : new Error(msg);
}

/** Encode a Groth16Proof{a,b,c} as its contract struct ScVal (same as the batch path). */
function groth16ProofScVal(proof: { a: Buffer; b: Buffer; c: Buffer }): xdr.ScVal {
  return nativeToScVal(
    { a: proof.a, b: proof.b, c: proof.c },
    { type: { a: ['symbol', 'bytes'], b: ['symbol', 'bytes'], c: ['symbol', 'bytes'] } },
  );
}

/**
 * Encode a GlobalProof struct ScVal (the second proof for a global-private). Struct
 * fields are an ScMap sorted by symbol key: commitment, nullifiers, proof, reset_r2,
 * reset_r7.
 */
function globalProofScVal(g: {
  commitmentHex: string;
  nullifiers: Buffer[];
  resetR2: boolean;
  resetR7: boolean;
  proof: { a: Buffer; b: Buffer; c: Buffer };
}): xdr.ScVal {
  const commitment = Buffer.from(g.commitmentHex, 'hex');
  if (commitment.length !== 32) throw new Error('global commitment must be 32 bytes');
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('commitment'),
      val: nativeToScVal(commitment, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('nullifiers'),
      val: xdr.ScVal.scvVec(g.nullifiers.map((n) => nativeToScVal(n, { type: 'bytes' }))),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('proof'), val: groth16ProofScVal(g.proof) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('reset_r2'), val: xdr.ScVal.scvBool(g.resetR2) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('reset_r7'), val: xdr.ScVal.scvBool(g.resetR7) }),
  ]);
}

/** A cleartext public rule as the API/dapp expresses it (USDC + seconds). */
export interface PublicRuleInput {
  perPaymentMaxUsdc: number;
  perPaymentMinUsdc: number;
  rollingCapUsdc: number;
  rollingWindowSecs: number;
  velocityMax: number;
  velocityWindowSecs: number;
  allowlist: { addr: string; capUsdc: number }[];
  denylist: string[];
  denylistThresholdUsdc: number;
  calendarStart: number;
  calendarEnd: number;
}

/** Encode a PublicRule struct ScVal (ScMap, fields sorted by symbol key). */
function publicRuleScVal(r: PublicRuleInput): xdr.ScVal {
  const i128 = (usdc: number) => nativeToScVal(usdcToStroops(usdc), { type: 'i128' });
  const u64 = (n: number) => nativeToScVal(BigInt(Math.max(0, Math.round(n))), { type: 'u64' });
  const payee = (p: { addr: string; capUsdc: number }) =>
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('addr'), val: new Address(p.addr).toScVal() }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('cap'), val: i128(p.capUsdc) }),
    ]);
  // Sorted by symbol: allowlist, calendar_end, calendar_start, denylist,
  // denylist_threshold, per_payment_max, per_payment_min, rolling_cap,
  // rolling_window_secs, velocity_max, velocity_window_secs.
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('allowlist'),
      val: xdr.ScVal.scvVec(r.allowlist.map(payee)),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('calendar_end'), val: u64(r.calendarEnd) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('calendar_start'), val: u64(r.calendarStart) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('denylist'),
      val: xdr.ScVal.scvVec(r.denylist.map((a) => new Address(a).toScVal())),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('denylist_threshold'),
      val: i128(r.denylistThresholdUsdc),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('per_payment_max'),
      val: i128(r.perPaymentMaxUsdc),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('per_payment_min'),
      val: i128(r.perPaymentMinUsdc),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('rolling_cap'), val: i128(r.rollingCapUsdc) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('rolling_window_secs'),
      val: u64(r.rollingWindowSecs),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('velocity_max'),
      val: nativeToScVal(Math.max(0, Math.round(r.velocityMax)), { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('velocity_window_secs'),
      val: u64(r.velocityWindowSecs),
    }),
  ]);
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
  private readonly relayerKey: string;
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
    // Keyless releases submit via a fee-payer that has NO authority over funds
    // (the proof authorizes). Falls back to the admin account when no dedicated
    // relayer is configured, so the Sovereign private path works out of the box.
    this.relayerKey = (config.get('RELAYER_SECRET_KEY', { infer: true }) ?? '') || this.adminKey;
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
      // A contract rejection surfaces here as a HostError even for build-time
      // simulation (e.g. set_public_rule with bad params); translate it to a clean
      // message instead of leaking the raw dump.
      mapContractError(new Error(simulated.error));
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
  // authorizes it ONCE (register_session, wallet-signed) with a spend cap + expiry;
  // the server then signs each release with the delegate (release_payment_session),
  // and the vault enforces the cap (and any named/global public rule) on-chain. A
  // server-held key is the simple cap+expiry form (rule_id null).

  /**
   * Unsigned `register_session(user, session, asset, expiry, spend_cap, rule_id,
   * server_held)` XDR. A key is bounded by a spend cap and/or a named public rule.
   */
  async buildRegisterSessionXdr(
    userAddress: string,
    sessionPublicKey: string,
    expiry: number,
    spendCapUsdc: number,
    ruleIdHex: string | null,
    serverHeld: boolean,
  ): Promise<string> {
    this.ensureActive();
    const ruleIdScVal = ruleIdHex
      ? xdr.ScVal.scvBytes(Buffer.from(ruleIdHex.replace(/^0x/, ''), 'hex'))
      : xdr.ScVal.scvVoid();
    return this.buildUnsignedXdr(userAddress, 'register_session', [
      new Address(userAddress).toScVal(),
      new Address(sessionPublicKey).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(BigInt(expiry), { type: 'u64' }),
      nativeToScVal(usdcToStroops(spendCapUsdc), { type: 'i128' }),
      ruleIdScVal,
      xdr.ScVal.scvBool(serverHeld),
    ]);
  }

  /** Unsigned `set_session_paused(user, session, paused)` XDR (pause/unpause a key). */
  async buildSetSessionPausedXdr(
    userAddress: string,
    sessionPublicKey: string,
    paused: boolean,
  ): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'set_session_paused', [
      new Address(userAddress).toScVal(),
      new Address(sessionPublicKey).toScVal(),
      xdr.ScVal.scvBool(paused),
    ]);
  }

  /** Unsigned `update_session(user, session, new_expiry, new_spend_cap)` XDR (0 = leave). */
  async buildUpdateSessionXdr(
    userAddress: string,
    sessionPublicKey: string,
    newExpiry: number,
    newSpendCapUsdc: number,
  ): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'update_session', [
      new Address(userAddress).toScVal(),
      new Address(sessionPublicKey).toScVal(),
      nativeToScVal(BigInt(newExpiry), { type: 'u64' }),
      nativeToScVal(usdcToStroops(newSpendCapUsdc), { type: 'i128' }),
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
  async releaseViaSession(
    delegate: Keypair,
    payee: string,
    amountUsdc: number,
    ruleIdHex?: string | null,
  ): Promise<string> {
    this.ensureActive();
    // The public rule selected for THIS spend (per task); Void = none (cap-only, or
    // fall back to the rule bound to the session at registration).
    const ruleArg = ruleIdHex ? xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)) : xdr.ScVal.scvVoid();
    const { hash } = await this.signAndSubmitAsOrchestrator(delegate, 'release_payment_session', [
      new Address(delegate.publicKey()).toScVal(),
      new Address(payee).toScVal(),
      nativeToScVal(usdcToStroops(amountUsdc), { type: 'i128' }),
      ruleArg,
    ]);
    return hash;
  }

  /**
   * Read a session's live on-chain scope (`get_session`). Returns null when no
   * session is registered for the key (SessionNotFound or revoked). Read-only
   * simulation with a throwaway source, nothing submitted.
   */
  async readSession(sessionPublicKey: string): Promise<{
    spendCapUsdc: number;
    spentUsdc: number;
    remainingUsdc: number;
    expiry: number;
    ruleId: string | null;
    serverHeld: boolean;
    paused: boolean;
    releaseCount: number;
  } | null> {
    this.ensureActive();
    const s = (await this.simulateReadRaw('get_session', [
      new Address(sessionPublicKey).toScVal(),
    ])) as {
      asset: string;
      expiry: bigint | number;
      spend_cap: bigint | number;
      rule_id: Buffer | Uint8Array | null;
      server_held: boolean;
      paused: boolean;
      spent: bigint | number;
      release_count: number;
    } | null;
    if (!s) return null;
    const cap = Number(s.spend_cap) / STROOPS_PER_USDC;
    const spent = Number(s.spent) / STROOPS_PER_USDC;
    return {
      spendCapUsdc: cap,
      spentUsdc: spent,
      remainingUsdc: cap > 0 ? Math.max(0, cap - spent) : 0,
      expiry: Number(s.expiry),
      ruleId: s.rule_id ? Buffer.from(s.rule_id).toString('hex') : null,
      serverHeld: !!s.server_held,
      paused: !!s.paused,
      releaseCount: Number(s.release_count),
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

  // ── Global rules (AND-filter applied to every spend in a lane) ───────────────

  /** A soroban unit-variant enum (Lane) encodes as a 1-element vec of its symbol. */
  private laneScVal(lane: 'Private' | 'Public'): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(lane)]);
  }

  /** Unsigned set_global(user, Private, commitment): pin a rule as the global-private. */
  async buildSetGlobalPrivateXdr(userAddress: string, commitmentHex: string): Promise<string> {
    this.ensureActive();
    const bytes = Buffer.from(commitmentHex.replace(/^0x/, ''), 'hex');
    return this.buildUnsignedXdr(userAddress, 'set_global', [
      new Address(userAddress).toScVal(),
      this.laneScVal('Private'),
      xdr.ScVal.scvBytes(bytes),
    ]);
  }

  /** Unsigned clear_global(user, Private). */
  async buildClearGlobalPrivateXdr(userAddress: string): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'clear_global', [
      new Address(userAddress).toScVal(),
      this.laneScVal('Private'),
    ]);
  }

  /** Read get_global(user, Private): the global-private commitment hex, or null. */
  async readGlobalPrivate(userAddress: string): Promise<string | null> {
    this.ensureActive();
    const server = this.server();
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(
        new Contract(this.contractId).call(
          'get_global',
          new Address(userAddress).toScVal(),
          this.laneScVal('Private'),
        ),
      )
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
    const val = scValToNative(sim.result.retval) as Buffer | Uint8Array | null;
    return val ? Buffer.from(val).toString('hex') : null;
  }

  private ridBytes(ruleIdHex: string): Buffer {
    const b = Buffer.from(ruleIdHex.replace(/^0x/, ''), 'hex');
    if (b.length !== 32) throw new BadRequestException('rule id must be 32-byte hex');
    return b;
  }

  /** Unsigned set_public_rule(user, rule_id, rule): store a named cleartext public rule. */
  async buildSetPublicRuleXdr(
    userAddress: string,
    ruleIdHex: string,
    rule: PublicRuleInput,
  ): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'set_public_rule', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)),
      publicRuleScVal(rule),
    ]);
  }

  /** Unsigned clear_public_rule(user, rule_id). */
  async buildClearPublicRuleXdr(userAddress: string, ruleIdHex: string): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'clear_public_rule', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)),
    ]);
  }

  /** Unsigned set_global_public(user, rule_id): mark a stored public rule as the global. */
  async buildSetGlobalPublicXdr(userAddress: string, ruleIdHex: string): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'set_global_public', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)),
    ]);
  }

  /** Unsigned clear_global_public(user). */
  async buildClearGlobalPublicXdr(userAddress: string): Promise<string> {
    this.ensureActive();
    return this.buildUnsignedXdr(userAddress, 'clear_global_public', [
      new Address(userAddress).toScVal(),
    ]);
  }

  /** Read a read-only call's decoded return value with a throwaway source. */
  private async simulateReadRaw(method: string, args: xdr.ScVal[]): Promise<unknown | null> {
    const server = this.server();
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(new Contract(this.contractId).call(method, ...args))
      .setTimeout(300)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
    return scValToNative(sim.result.retval);
  }

  /** Read the rule_id of the account global-public rule (hex), or null. */
  async readGlobalPublic(userAddress: string): Promise<string | null> {
    this.ensureActive();
    const v = (await this.simulateReadRaw('get_global_public', [
      new Address(userAddress).toScVal(),
    ])) as Buffer | Uint8Array | null;
    return v ? Buffer.from(v).toString('hex') : null;
  }

  /** Read a named public rule (decoded to USDC / seconds), or null. */
  async readPublicRule(userAddress: string, ruleIdHex: string): Promise<PublicRuleInput | null> {
    this.ensureActive();
    const v = (await this.simulateReadRaw('get_public_rule', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)),
    ])) as {
      per_payment_max: bigint | number;
      per_payment_min: bigint | number;
      rolling_cap: bigint | number;
      rolling_window_secs: bigint | number;
      velocity_max: number;
      velocity_window_secs: bigint | number;
      allowlist: { addr: string; cap: bigint | number }[];
      denylist: string[];
      denylist_threshold: bigint | number;
      calendar_start: bigint | number;
      calendar_end: bigint | number;
    } | null;
    if (!v) return null;
    const usdc = (x: bigint | number) => Number(x) / STROOPS_PER_USDC;
    return {
      perPaymentMaxUsdc: usdc(v.per_payment_max),
      perPaymentMinUsdc: usdc(v.per_payment_min),
      rollingCapUsdc: usdc(v.rolling_cap),
      rollingWindowSecs: Number(v.rolling_window_secs),
      velocityMax: Number(v.velocity_max),
      velocityWindowSecs: Number(v.velocity_window_secs),
      allowlist: v.allowlist.map((p) => ({ addr: p.addr, capUsdc: usdc(p.cap) })),
      denylist: v.denylist,
      denylistThresholdUsdc: usdc(v.denylist_threshold),
      calendarStart: Number(v.calendar_start),
      calendarEnd: Number(v.calendar_end),
    };
  }

  /** Read live usage for a public rule (window + lifetime spend/count), or null. */
  async readPublicUsage(
    userAddress: string,
    ruleIdHex: string,
  ): Promise<{
    windowSpentUsdc: number;
    windowCount: number;
    lifetimeSpentUsdc: number;
    lifetimeCount: number;
    anchorR2: number;
    anchorR7: number;
  } | null> {
    this.ensureActive();
    const v = (await this.simulateReadRaw('get_public_usage', [
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(this.ridBytes(ruleIdHex)),
    ])) as {
      window_spent: bigint | number;
      window_count: number;
      lifetime_spent: bigint | number;
      lifetime_count: number;
      anchor_r2: bigint | number;
      anchor_r7: bigint | number;
    } | null;
    if (!v) return null;
    return {
      windowSpentUsdc: Number(v.window_spent) / STROOPS_PER_USDC,
      windowCount: Number(v.window_count),
      lifetimeSpentUsdc: Number(v.lifetime_spent) / STROOPS_PER_USDC,
      lifetimeCount: Number(v.lifetime_count),
      anchorR2: Number(v.anchor_r2),
      anchorR7: Number(v.anchor_r7),
    };
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
      let reason = 'rejected';
      try {
        reason = response.errorResult?.result().switch().name ?? reason;
      } catch {
        // keep the generic reason
      }
      if (/txBadSeq/i.test(reason)) {
        throw new ServiceUnavailableException(
          'The network was busy (sequence conflict). Please try again in a moment.',
        );
      }
      throw new ServiceUnavailableException(`The vault transaction was rejected (${reason}).`);
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
        // A contract rejection (session paused, cap exceeded, rule violated, ...)
        // surfaces as a HostError at simulation; translate it to a clean message.
        mapContractError(new Error(simulated.error));
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

  /**
   * KEYLESS proof-authorized release (the plan's Sovereign private path). The vault
   * takes NO require_auth here: the user's on-chain pinned commitment + the ZK proof
   * (made where the salt lives, on the user's device) + a fresh nullifier ARE the
   * authorization. The relayer keypair only pays the fee and submits; it cannot learn
   * the rule, redirect a payee, or replay. No per-user delegate is involved. When a
   * global-private is set the caller passes the second proof (the vault requires it).
   */
  async releaseProvedKeyless(params: {
    user: string;
    commitmentHex: string;
    payees: string[];
    amountsStroops: bigint[];
    nullifiers: Buffer[];
    validAfter: bigint;
    validBefore: bigint;
    resetR2: boolean;
    resetR7: boolean;
    proof: { a: Buffer; b: Buffer; c: Buffer };
    global?: {
      commitmentHex: string;
      nullifiers: Buffer[];
      resetR2: boolean;
      resetR7: boolean;
      proof: { a: Buffer; b: Buffer; c: Buffer };
    } | null;
  }): Promise<string> {
    this.ensureActive();
    if (!this.relayerKey) {
      throw new ServiceUnavailableException('keyless relayer not configured');
    }
    const kp = Keypair.fromSecret(this.relayerKey);
    const commitment = Buffer.from(params.commitmentHex, 'hex');
    if (commitment.length !== 32)
      throw new ServiceUnavailableException('commitment must be 32 bytes');
    const args: xdr.ScVal[] = [
      new Address(params.user).toScVal(),
      this.usdcSacScVal(),
      nativeToScVal(commitment, { type: 'bytes' }),
      xdr.ScVal.scvVec(params.payees.map((p) => new Address(p).toScVal())),
      xdr.ScVal.scvVec(params.amountsStroops.map((a) => nativeToScVal(a, { type: 'i128' }))),
      xdr.ScVal.scvVec(params.nullifiers.map((n) => nativeToScVal(n, { type: 'bytes' }))),
      nativeToScVal(params.validAfter, { type: 'u64' }),
      nativeToScVal(params.validBefore, { type: 'u64' }),
      xdr.ScVal.scvBool(params.resetR2),
      xdr.ScVal.scvBool(params.resetR7),
      groth16ProofScVal(params.proof),
      params.global ? globalProofScVal(params.global) : xdr.ScVal.scvVoid(),
    ];
    try {
      const { hash } = await this.signAndSubmitAsOrchestrator(kp, 'release_proved_keyless', args);
      return hash;
    } catch (e) {
      // Turn a raw HostError (e.g. CommitmentNotAuthorized) into a clean 400 message
      // the dapp and SDK/MCP can show directly.
      mapContractError(e);
    }
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
