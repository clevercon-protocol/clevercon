/**
 * Session keys: the public ("Fast") spending lane for an agent.
 *
 * The owner authorizes a bounded session ONCE with their wallet (a per-asset
 * budget, a payee allowlist, and a hard expiry), and the agent then spends with
 * only the SESSION key - no per-payment proof, no owner signature. The scope is
 * enforced on-chain by the vault on every release, so a compromised session key
 * can never pay a non-allowlisted payee, exceed the budget, or spend past expiry,
 * and the owner revokes instantly. This is the self+public custody model: the
 * agent holds the session key itself. (Managed Sessions - server+public - uses the
 * same on-chain primitive with the key held server-side.)
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

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const UNIT = 10_000_000; // 1 USDC in stroops (7 decimals)
const INCLUSION_FEE = '1000000'; // 0.1 XLM; prepareTransaction adds the resource fee

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
  /** Spend cap for the whole session, in USDC. */
  budgetUsdc: number;
  /** The exact set of payees this session may pay (1..32 addresses). */
  allowlist: string[];
  /** Seconds from now until the session's hard expiry. */
  expiresInSeconds: number;
  /** Optional existing session secret to register; otherwise a fresh key is minted. */
  sessionSecret?: string;
}

export interface RegisteredSession {
  /** Hold this in the agent: the only credential that can spend under the scope. */
  sessionSecret: string;
  sessionPublicKey: string;
  budgetUsdc: number;
  /** Unix-second ledger-time cutoff after which the key is dead. */
  expiry: number;
  allowlist: string[];
  txHash: string;
}

export interface SessionScope {
  owner: string;
  asset: string;
  budgetRemainingUsdc: number;
  expiry: number;
  allowlist: string[];
  spentUsdc: number;
}

export interface SessionSpender {
  /** The session's public key (the on-chain authorizer the ledger records). */
  readonly publicKey: string;
  /** Pay an allowlisted payee from the owner's vault balance, signed by the session key. */
  pay(payee: string, amountUsdc: number): Promise<{ txHash: string }>;
  /** Read the session's live on-chain scope + remaining budget. */
  scope(): Promise<SessionScope>;
}

// ── encoders ─────────────────────────────────────────────────────────────────
const toStroops = (usdc: number): bigint => BigInt(Math.round(usdc * UNIT));
const fromStroops = (s: bigint | number): number => Number(s) / UNIT;
const addr = (pk: string): xdr.ScVal => new Address(pk).toScVal();
const i128 = (stroops: bigint): xdr.ScVal => nativeToScVal(stroops, { type: 'i128' });
const u64 = (v: number): xdr.ScVal => nativeToScVal(BigInt(v), { type: 'u64' });
const addrVec = (pks: string[]): xdr.ScVal => xdr.ScVal.scvVec(pks.map((p) => addr(p)));

function server(net: SessionNetwork): rpc.Server {
  return new rpc.Server(net.rpcUrl ?? DEFAULT_RPC_URL);
}
function passphrase(net: SessionNetwork): string {
  return net.networkPassphrase ?? Networks.TESTNET;
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
    throw new SessionError(`${method} rejected on-chain: ${(e as Error).message}`);
  });
  prepared.sign(source);
  const sent = await srv.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new SessionError(`${method} submit failed: ${JSON.stringify(sent.errorResult ?? {})}`);
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
  return {
    owner: raw.user,
    asset: raw.asset,
    budgetRemainingUsdc: fromStroops(raw.budget_remaining),
    expiry: Number(raw.expiry),
    allowlist: raw.allowlist as string[],
    spentUsdc: fromStroops(raw.spent),
  };
}

/**
 * Register a bounded session key. The owner signs once; a fresh session key is
 * minted (or `sessionSecret` reused). Returns the session secret to hand to the
 * agent, which then spends with {@link createSessionSpender}.
 */
export async function registerSession(opts: RegisterSessionOptions): Promise<RegisteredSession> {
  if (opts.budgetUsdc <= 0) throw new SessionError('budgetUsdc must be positive');
  if (opts.allowlist.length < 1 || opts.allowlist.length > 32) {
    throw new SessionError('allowlist must have 1..32 payees');
  }
  if (opts.expiresInSeconds <= 0) throw new SessionError('expiresInSeconds must be positive');

  const owner = Keypair.fromSecret(opts.ownerSecret);
  const session = opts.sessionSecret ? Keypair.fromSecret(opts.sessionSecret) : Keypair.random();
  const expiry = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;

  const txHash = await invoke(opts, owner, 'register_session', [
    addr(owner.publicKey()),
    addr(session.publicKey()),
    addr(opts.usdcSac),
    i128(toStroops(opts.budgetUsdc)),
    u64(expiry),
    addrVec(opts.allowlist),
  ]);

  return {
    sessionSecret: session.secret(),
    sessionPublicKey: session.publicKey(),
    budgetUsdc: opts.budgetUsdc,
    expiry,
    allowlist: opts.allowlist,
    txHash,
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
    pay: async (payee, amountUsdc) => {
      if (amountUsdc <= 0) throw new SessionError('amountUsdc must be positive');
      const txHash = await invoke(opts, session, 'release_payment_session', [
        addr(session.publicKey()),
        addr(payee),
        i128(toStroops(amountUsdc)),
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
