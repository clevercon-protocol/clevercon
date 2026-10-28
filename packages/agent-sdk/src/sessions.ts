/**
 * Session keys: the public ("Fast") spending lane for an agent (self + public
 * custody: the AGENT holds the session key itself).
 *
 * The owner authorizes a bounded session ONCE with their wallet, and the agent then
 * spends with only the SESSION key - no per-payment proof, no owner signature. A
 * session is bounded by a total spend cap AND/OR a named public rule id (at least
 * one): the cap limits the lifetime total, and the public rule (registered on-chain
 * via the dapp/API, cleartext) adds the full clause set - per-payment max/min,
 * rolling cap, velocity, allowlist + per-payee cap, deny-list, calendar - which the
 * vault checks in the clear on every release. A local key may be open-ended (no
 * expiry) because the owner holds it; a server-held (Managed Session) key, by
 * contrast, is always time-boxed and capped. The scope is enforced on-chain on every
 * release, so a compromised session key can never exceed the cap, break the rule, or
 * spend past expiry, and the owner revokes (or pauses) instantly.
 *
 * All calls go straight to Soroban RPC; sessions need no CleverCon API. The agent
 * keeps a little XLM on the session account to pay its own transaction fees.
 */
import {
  Keypair,
  TransactionBuilder,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  rpc,
  Networks,
} from '@stellar/stellar-sdk';
import { packSessionKey, unpackSessionKey } from './config-tokens.js';

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const UNIT = 10_000_000; // 1 USDC in stroops (7 decimals)
const INCLUSION_FEE = '1000000'; // 0.1 XLM; prepareTransaction adds the resource fee

// Network constants so a local-key agent config can be just the secret (the vault +
// USDC SAC are fixed per network, not per user). Override via the SessionNetwork /
// env on another deployment or mainnet.
export const DEFAULT_TESTNET_VAULT_ID = 'CDVMPHPD3V6KNVS2ORBQD6A6FSWDCHN7RK2LW4C2KUPHZLM5H3KNKK6A';
export const DEFAULT_TESTNET_USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

/** Raised when a session call fails on-chain (scope exceeded, expired, revoked, ...). */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/** Where the vault + asset live. */
export interface SessionNetwork {
  /** The CleverCon vault contract id. */
  vaultId: string;
  /** The asset's Stellar Asset Contract id (USDC SAC). */
  usdcSac: string;
  /** Soroban RPC URL. Defaults to Stellar testnet. */
  rpcUrl?: string;
  /** Network passphrase. Defaults to testnet. */
  networkPassphrase?: string;
}

export interface RegisterSessionOptions extends SessionNetwork {
  /** The owner's wallet secret (self-custody); signs ONCE to authorize the scope. */
  ownerSecret: string;
  /**
   * Total lifetime spend cap in USDC. Optional ONLY if `ruleId` is set (a session
   * must be bounded by a cap and/or a rule). 0 / omitted = no cap (rule-bounded).
   */
  spendCapUsdc?: number;
  /**
   * A named public rule id (32-byte hex) this session runs under: the vault checks
   * its full cleartext clause set on every release. Register the rule first (dapp
   * Rules tab or POST /vault/public-rule/set). Optional ONLY if `spendCapUsdc` is set.
   */
  ruleId?: string;
  /**
   * Seconds from now until a hard expiry. Optional for a local key (the owner holds
   * it): omit / 0 = open-ended, revoke to end it.
   */
  expiresInSeconds?: number;
  /** Optional existing session secret to register; otherwise a fresh key is minted. */
  sessionSecret?: string;
}

export interface RegisteredSession {
  /** Hold this in the agent: the only credential that can spend under the scope. */
  sessionSecret: string;
  sessionPublicKey: string;
  spendCapUsdc: number;
  /** The public rule id this key runs under (hex), or null if cap-only. */
  ruleId: string | null;
  /** Unix-second ledger-time cutoff after which the key is dead (0 = open-ended). */
  expiry: number;
  txHash: string;
  /**
   * ONE opaque token to hand the agent (CLEVERCON_SESSION_KEY): it packs the session
   * secret, the vault + USDC ids, the RPC, and the rule - so a local-key agent config
   * is a single line instead of four env vars. Keep it as private as the key inside.
   */
  sessionKey: string;
}

export interface SessionScope {
  owner: string;
  asset: string;
  /** Total lifetime cap (0 = uncapped, bounded by the rule). */
  spendCapUsdc: number;
  spentUsdc: number;
  /** Cap minus spent (0 when uncapped). */
  remainingUsdc: number;
  /** Unix-second expiry (0 = open-ended). */
  expiry: number;
  /** The public rule id this key runs under (hex), or null if cap-only. */
  ruleId: string | null;
  /** True for a platform-held (Managed Session) key; false for a local key. */
  serverHeld: boolean;
  paused: boolean;
  /** Successful releases so far (observability; a rejected release reverts). */
  releaseCount: number;
}

export interface SessionSpender {
  /** The session's public key (the on-chain authorizer the ledger records). */
  readonly publicKey: string;
  /**
   * Pay a payee from the owner's vault balance, signed by the session key. Pass
   * `ruleId` (a 32-byte hex public rule id) to enforce that rule for THIS spend
   * (selected per task); omit it to fall back to the rule bound to the session at
   * registration, or cap-only. The key's own cap + expiry always apply.
   */
  pay(payee: string, amountUsdc: number, ruleId?: string): Promise<{ txHash: string }>;
  /** Read the session's live on-chain scope + remaining budget. */
  scope(): Promise<SessionScope>;
}

// ── encoders ─────────────────────────────────────────────────────────────────
const toStroops = (usdc: number): bigint => BigInt(Math.round(usdc * UNIT));
const fromStroops = (s: bigint | number): number => Number(s) / UNIT;
const addr = (pk: string): xdr.ScVal => new Address(pk).toScVal();
const i128 = (stroops: bigint): xdr.ScVal => nativeToScVal(stroops, { type: 'i128' });
const u64 = (v: number): xdr.ScVal => nativeToScVal(BigInt(v), { type: 'u64' });
const bool = (b: boolean): xdr.ScVal => xdr.ScVal.scvBool(b);
/** Encode an Option<BytesN<32>>: None -> Void, Some(id) -> the 32 bytes directly. */
const optBytes32 = (hex?: string): xdr.ScVal => {
  if (!hex) return xdr.ScVal.scvVoid();
  const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  if (b.length !== 32) throw new SessionError('ruleId must be 32-byte hex (64 chars)');
  return xdr.ScVal.scvBytes(b);
};

function server(net: SessionNetwork): rpc.Server {
  return new rpc.Server(net.rpcUrl ?? DEFAULT_RPC_URL);
}
function passphrase(net: SessionNetwork): string {
  return net.networkPassphrase ?? Networks.TESTNET;
}

// Clean, actionable messages for the vault's VaultError codes a session spend can hit,
// so local-mode rejections read like a sentence instead of a raw HostError dump (the
// server path gets the same via the API). Mirrors the API's translator.
const SESSION_ERROR_MESSAGES: Record<number, string> = {
  2: 'The vault is paused by the operator; try again shortly.',
  5: 'Not enough balance in the vault for this.',
  6: 'Not enough available balance (some is locked by active jobs).',
  11: 'Invalid amount.',
  42: 'This session key is not registered (or was revoked).',
  43: 'This session key has expired.',
  44: 'That payee is not on the rule’s approved list.',
  45: 'This payment would exceed the session key’s spend cap.',
  46: 'Only the owner can manage this session.',
  50: 'That payee is blocked by the rule’s deny-list.',
  51: 'This payment exceeds the rule’s per-payment cap.',
  52: 'This session key has expired.',
  53: 'This session key is paused; unpause it to spend again.',
  54: 'The public rule this key runs under no longer exists.',
  55: 'This payment is below the rule’s per-payment minimum.',
  56: 'This payment would exceed the rule’s rolling cap for its window.',
  57: 'This payment would exceed the rule’s rate limit (too many in the window).',
  58: 'This payment is outside the rule’s allowed calendar window.',
  60: 'This session key is unbounded (needs a cap and/or a rule).',
};

/** Turn a raw Soroban `Error(Contract, #NN)` / HostError into a clean sentence. */
function cleanContractError(raw: string, method: string): string {
  const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    return SESSION_ERROR_MESSAGES[code] ?? `The vault rejected this (code #${code}).`;
  }
  return `${method} failed: ${raw}`;
}

/** Build, simulate/assemble, sign (source), submit, and poll a vault invocation. */
async function invoke(
  net: SessionNetwork,
  source: Keypair,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const srv = server(net);
  const account = await srv.getAccount(source.publicKey());
  const built = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase: passphrase(net),
  })
    .addOperation(new Contract(net.vaultId).call(method, ...args))
    .setTimeout(120)
    .build();

  // prepareTransaction simulates and assembles the footprint/auth; it throws if
  // the contract would reject (scope exceeded, expired, revoked, ...).
  const prepared = await srv.prepareTransaction(built).catch((e: unknown) => {
    throw new SessionError(cleanContractError((e as Error).message, method));
  });
  prepared.sign(source);
  const sent = await srv.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new SessionError(cleanContractError(JSON.stringify(sent.errorResult ?? {}), method));
  }
  let got = await srv.getTransaction(sent.hash);
  for (let i = 0; i < 40 && got.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    got = await srv.getTransaction(sent.hash);
  }
  if (got.status !== 'SUCCESS') {
    throw new SessionError(`${method} did not confirm (status ${got.status})`);
  }
  return sent.hash;
}

/**
 * Read-only simulate of a view (no funds move, no state change). The simulation
 * still needs a source account that exists on-ledger for its sequence; callers
 * pass a funded account they control (the session or the owner).
 */
async function simulateRead(
  net: SessionNetwork,
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const srv = server(net);
  const account = await srv.getAccount(sourcePublicKey);
  const built = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase: passphrase(net),
  })
    .addOperation(new Contract(net.vaultId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await srv.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) {
    throw new SessionError(`${method} read failed: ${sim.error}`);
  }
  return scValToNative(sim.result!.retval);
}

function decodeScope(raw: any): SessionScope {
  const cap = fromStroops(raw.spend_cap);
  const spent = fromStroops(raw.spent);
  // scValToNative decodes Option<BytesN<32>> as a Buffer/Uint8Array (Some) or null.
  const rid = raw.rule_id ? Buffer.from(raw.rule_id).toString('hex') : null;
  return {
    owner: raw.user,
    asset: raw.asset,
    spendCapUsdc: cap,
    spentUsdc: spent,
    remainingUsdc: cap > 0 ? Math.max(0, cap - spent) : 0,
    expiry: Number(raw.expiry),
    ruleId: rid,
    serverHeld: !!raw.server_held,
    paused: !!raw.paused,
    releaseCount: Number(raw.release_count ?? 0),
  };
}

/**
 * Register a bounded session key. The owner signs once; a fresh session key is
 * minted (or `sessionSecret` reused). Returns the session secret to hand to the
 * agent, which then spends with {@link createSessionSpender}.
 */
export async function registerSession(opts: RegisterSessionOptions): Promise<RegisteredSession> {
  const cap = opts.spendCapUsdc ?? 0;
  if (cap < 0) throw new SessionError('spendCapUsdc cannot be negative');
  // A session must be bounded by a cap and/or a named rule, else it is unbounded.
  if (cap === 0 && !opts.ruleId) {
    throw new SessionError('a session needs a spendCapUsdc and/or a ruleId');
  }
  if (opts.expiresInSeconds != null && opts.expiresInSeconds < 0) {
    throw new SessionError('expiresInSeconds cannot be negative');
  }

  const owner = Keypair.fromSecret(opts.ownerSecret);
  const session = opts.sessionSecret ? Keypair.fromSecret(opts.sessionSecret) : Keypair.random();
  // A local key (server_held=false) may be open-ended: 0 = no expiry.
  const expiry = opts.expiresInSeconds ? Math.floor(Date.now() / 1000) + opts.expiresInSeconds : 0;

  const txHash = await invoke(opts, owner, 'register_session', [
    addr(owner.publicKey()),
    addr(session.publicKey()),
    addr(opts.usdcSac),
    u64(expiry),
    i128(toStroops(cap)),
    optBytes32(opts.ruleId),
    bool(false), // self-custody: the agent holds this key locally
  ]);

  return {
    sessionSecret: session.secret(),
    sessionPublicKey: session.publicKey(),
    spendCapUsdc: cap,
    ruleId: opts.ruleId ?? null,
    expiry,
    txHash,
    sessionKey: packSessionKey({
      sessionSecret: session.secret(),
      vaultId: opts.vaultId,
      usdcSac: opts.usdcSac,
      rpcUrl: opts.rpcUrl,
      ruleId: opts.ruleId,
    }),
  };
}

/**
 * The agent-side spender for an already-registered session. Holds only the session
 * key; `pay` is signed by it (the session account pays its own tx fee, so keep a
 * little XLM on it).
 */
export function createSessionSpender(
  opts: SessionNetwork & { sessionSecret: string },
): SessionSpender {
  const session = Keypair.fromSecret(opts.sessionSecret);
  return {
    publicKey: session.publicKey(),
    pay: async (payee, amountUsdc, ruleId) => {
      if (amountUsdc <= 0) throw new SessionError('amountUsdc must be positive');
      const txHash = await invoke(opts, session, 'release_payment_session', [
        addr(session.publicKey()),
        addr(payee),
        i128(toStroops(amountUsdc)),
        optBytes32(ruleId),
      ]);
      return { txHash };
    },
    scope: async () => {
      const raw = await simulateRead(opts, session.publicKey(), 'get_session', [
        addr(session.publicKey()),
      ]);
      return decodeScope(raw);
    },
  };
}

/**
 * Build a session spender straight from a `CLEVERCON_SESSION_KEY` token (the one
 * string `registerSession` returns): it unpacks the secret + network + rule, so an
 * agent needs no other config. `pay` defaults to the rule packed in the token when a
 * per-call ruleId is not given.
 */
export function createSessionSpenderFromKey(sessionKey: string): SessionSpender {
  const cfg = unpackSessionKey(sessionKey);
  const base = createSessionSpender({
    vaultId: cfg.vaultId,
    usdcSac: cfg.usdcSac,
    rpcUrl: cfg.rpcUrl,
    sessionSecret: cfg.sessionSecret,
  });
  return {
    publicKey: base.publicKey,
    pay: (payee, amountUsdc, ruleId) => base.pay(payee, amountUsdc, ruleId ?? cfg.ruleId),
    scope: base.scope,
  };
}

/** Instantly revoke a session. Only the owner can, by wallet signature. */
export async function revokeSession(
  opts: SessionNetwork & { ownerSecret: string; sessionPublicKey: string },
): Promise<{ txHash: string }> {
  const owner = Keypair.fromSecret(opts.ownerSecret);
  const txHash = await invoke(opts, owner, 'revoke_session', [
    addr(owner.publicKey()),
    addr(opts.sessionPublicKey),
  ]);
  return { txHash };
}

/** Pause / unpause a session (owner-signed). A paused key spends nothing until unpaused. */
export async function setSessionPaused(
  opts: SessionNetwork & { ownerSecret: string; sessionPublicKey: string; paused: boolean },
): Promise<{ txHash: string }> {
  const owner = Keypair.fromSecret(opts.ownerSecret);
  const txHash = await invoke(opts, owner, 'set_session_paused', [
    addr(owner.publicKey()),
    addr(opts.sessionPublicKey),
    bool(opts.paused),
  ]);
  return { txHash };
}

/**
 * Edit a session's bounds (owner-signed): extend the expiry and/or raise the total
 * spend cap. Pass 0 (or omit) to leave a field unchanged; the cap can never drop
 * below what has already been spent.
 */
export async function updateSession(
  opts: SessionNetwork & {
    ownerSecret: string;
    sessionPublicKey: string;
    newExpiresInSeconds?: number;
    newSpendCapUsdc?: number;
  },
): Promise<{ txHash: string }> {
  const owner = Keypair.fromSecret(opts.ownerSecret);
  const newExpiry = opts.newExpiresInSeconds
    ? Math.floor(Date.now() / 1000) + opts.newExpiresInSeconds
    : 0;
  const txHash = await invoke(opts, owner, 'update_session', [
    addr(owner.publicKey()),
    addr(opts.sessionPublicKey),
    u64(newExpiry),
    i128(toStroops(opts.newSpendCapUsdc ?? 0)),
  ]);
  return { txHash };
}

/**
 * Read a session's live on-chain scope without holding its key. `sourcePublicKey`
 * is any funded account used only as the read simulation's source (defaults to the
 * session account itself, which the self+public agent keeps funded for fees).
 */
export async function getSessionScope(
  net: SessionNetwork,
  sessionPublicKey: string,
  sourcePublicKey: string = sessionPublicKey,
): Promise<SessionScope> {
  const raw = await simulateRead(net, sourcePublicKey, 'get_session', [addr(sessionPublicKey)]);
  return decodeScope(raw);
}
