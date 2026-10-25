/**
 * The CleverCon spender SDK: give any app or agent a bounded, non-custodial
 * Stellar spending account in a few calls. Zero runtime dependencies (global
 * fetch only), keyed by a scoped API key, so importing it does not pull in x402
 * or express. It drives the same public API the console and MCP use.
 *
 *   const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });
 *   await cc.pay('G...', 5, { reason: 'design work' });
 *   await cc.disburse([{ payee: 'G...', amount: 2 }, { payee: 'G...', amount: 3 }]);
 *   const { available } = await cc.getBudget();
 *
 * Every spend is bounded by a policy and released from the vault; the agent
 * never holds funds.
 */

// Type-only imports: erased at compile, so importing createSpender never pulls in
// the prover (snarkjs/stellar) chain. The prover is loaded lazily in disbursePrivate.
import type { PolicyBundle } from './payments/policy-bundle.js';
import type { PoseidonArtifacts } from './payments/poseidon.js';

export interface SpenderOptions {
  /** Scoped API key (cc_...). */
  apiKey: string;
  /** API base URL. Defaults to CLEVERCON_API_URL, or the live CleverCon API. */
  apiUrl?: string;
  /** Override fetch (for tests or a custom agent). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
  /**
   * Self-custody PRIVATE disbursement (custody:self + mode:private): the owner's
   * policy bundle `{ rules, salt }`. Required to call {@link CleverConClient.disbursePrivate}
   * unless `CLEVERCON_POLICY_JSON` is set. It never leaves this process; only the
   * proof is relayed, so the server can neither read nor forge the rule.
   */
  policyBundle?: PolicyBundle;
  /**
   * The owner's global-private rule bundle `{ rules, salt }`, if one is set on-chain.
   * When present, disbursePrivate proves a SECOND proof against it (the vault requires
   * it when a global-private is pinned) and relays both. Falls back to
   * `CLEVERCON_GLOBAL_POLICY_JSON`. Omit when no global-private is set. This is the
   * "global salt" an SDK/MCP agent needs to spend while a global rule is active.
   */
  globalBundle?: PolicyBundle;
  /**
   * Circuit artifacts for local proving (paths or URLs). Falls back to
   * `CLEVERCON_PP2_WASM` / `CLEVERCON_PP2_ZKEY`; the poseidon set defaults to the
   * hosted artifacts when the policy needs it (allowlist/deny/calendar/category).
   */
  proverArtifacts?: { wasmPath: string; zkeyPath: string; poseidon?: PoseidonArtifacts };
}

export interface PaymentLine {
  payee: string;
  amount: number;
  reason?: string;
}

export interface SpendLimit {
  perPaymentCeilingUsdc?: number;
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  allowlist?: string[];
  isPrivate?: boolean;
}

export interface Budget {
  balance: number;
  available: number;
  locked: number;
}

export interface Spend {
  id: string;
  title: string;
  mode: string;
  status: string;
  budget: number;
  spent: number;
  createdAt: string;
}

export interface SavedLimit {
  id: string;
  commitment: string;
  isPrivate: boolean;
  rules: unknown;
  createdAt: string;
}

/** An API call that failed; carries the HTTP status so callers can branch on it. */
export class CleverConError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CleverConError';
  }
}

/**
 * The managed server-path spend (pp/1 binding proof) is retired. Throw a clear,
 * typed error pointing callers at the client-proven self-custody path.
 */
function retiredServerPath(): never {
  throw new CleverConError(
    410,
    'The managed server-path spend (pay/disburse) is retired: the policy verifier now ' +
      'carries only the pp/2 batch verifying key, so server-built binding proofs no longer ' +
      'verify on-chain. Use disbursePrivate for self-custody private spend (your policy is ' +
      'proven locally; only the proof is relayed). Managed/session-key spend is coming.',
  );
}

export interface CleverConClient {
  /**
   * @deprecated The managed server-path spend (pp/1) is retired: the policy verifier
   * now carries only the pp/2 batch verifying key, so server-built binding proofs no
   * longer verify on-chain. Use {@link CleverConClient.disbursePrivate} for self-custody
   * private spend (your policy is proven locally; only the proof is relayed). Managed /
   * session-key spend returns in a later release. Calling this throws immediately.
   */
  pay(
    payee: string,
    amount: number,
    opts?: { reason?: string; policyId?: string; idempotencyKey?: string },
  ): Promise<Spend>;
  /**
   * @deprecated See {@link CleverConClient.pay} - the managed server-path is retired.
   * Use {@link CleverConClient.disbursePrivate} instead. Calling this throws immediately.
   */
  disburse(
    lines: PaymentLine[],
    opts?: { policyId?: string; idempotencyKey?: string },
  ): Promise<Spend>;
  /**
   * Self-custody PRIVATE disburse (custody:self + mode:private), KEYLESS: prove the
   * owner's policy bundle LOCALLY (Groth16, up to 4 payees) and relay ONLY the proof.
   * The vault's release_proved_keyless takes no signature - the proof + the owner's
   * pinned commitment + a fresh nullifier authorize it - so there is no delegate and
   * no per-payment key; a fee-payer relayer only pays the network fee and can neither
   * read nor forge the rule. Synchronous: returns the on-chain tx hash. When a
   * global-private rule is set, pass `globalBundle` (or `CLEVERCON_GLOBAL_POLICY_JSON`)
   * and a second proof is relayed automatically. Requires `policyBundle` + artifacts
   * (options or env); fail-closed otherwise.
   */
  disbursePrivate(
    lines: PaymentLine[],
  ): Promise<{ txHash: string; totalUsdc: number; legs: number; commitment: string }>;
  /**
   * Public server-custody spend (custody:platform + mode:public): pay a payee via the
   * owner's Managed Session - a server-held key the OWNER authorized once in the dapp
   * (a total cap + expiry, plus an optional global public rule the vault AND-enforces).
   * Hands-off: no per-payment signature and no local key; the platform signs within
   * the on-chain scope, so it can never exceed the cap, break the global rule, or spend
   * past expiry. Returns the tx hash. Fails if no Managed Session is enabled.
   */
  sessionPay(payee: string, amount: number): Promise<{ txHash: string }>;
  /** The owner's live Managed Session (cap/spent/remaining/expiry/paused), or null. */
  getSession(): Promise<unknown>;
  /** Hire a registered service (DIRECT pays a chosen serviceId). `idempotencyKey`
   *  makes a retry return the original hire rather than hiring twice. */
  hire(opts: {
    title: string;
    budget: number;
    serviceId?: string;
    mode?: 'DIRECT' | 'SEARCH' | 'COMPOSE';
    policyId?: string;
    idempotencyKey?: string;
  }): Promise<Spend>;
  /** The vault position the agent can spend (balance, available, locked). */
  getBudget(): Promise<Budget>;
  /** The recent activity ledger (jobs and payments), newest first. */
  getActivity(): Promise<unknown>;
  /** Create a reusable spending limit; returns its policyId. */
  setLimit(limit: SpendLimit): Promise<SavedLimit>;
  /** List saved spending limits. */
  listLimits(): Promise<{ items: SavedLimit[]; total: number }>;
}

// Spend calls (pay/disburse/hire) lock budget on-chain in the request path, which
// can take several seconds on a busy RPC, so the default is generous.
const DEFAULT_TIMEOUT = 60_000;

export function createSpender(options: SpenderOptions): CleverConClient {
  const apiUrl = (
    options.apiUrl ??
    (typeof process !== 'undefined' ? process.env?.CLEVERCON_API_URL : undefined) ??
    'https://cleverconapi-production.up.railway.app'
  ).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!options.apiKey) throw new Error('createSpender: apiKey is required');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(apiUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { message?: unknown };
        detail = typeof j?.message === 'string' ? j.message : JSON.stringify(j);
      } catch {
        detail = await res.text().catch(() => '');
      }
      if (res.status === 401) throw new CleverConError(401, 'Unauthorized: check your API key');
      if (res.status === 429)
        throw new CleverConError(429, `Daily API quota exceeded${detail ? `: ${detail}` : ''}`);
      throw new CleverConError(res.status, detail || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const env = (k: string): string | undefined =>
    typeof process !== 'undefined' ? process.env?.[k] : undefined;

  // Resolve the owner's private policy bundle (fail-closed): the option wins, else
  // inline CLEVERCON_POLICY_JSON. Never a silent fallback to a server path.
  function resolveBundle(): PolicyBundle {
    if (options.policyBundle) return options.policyBundle;
    const raw = env('CLEVERCON_POLICY_JSON');
    if (!raw) {
      throw new Error(
        'disbursePrivate: no private policy bundle (set options.policyBundle or CLEVERCON_POLICY_JSON to {"rules":{...},"salt":"..."})',
      );
    }
    const b = JSON.parse(raw) as PolicyBundle;
    if (!b?.rules || !b?.salt) throw new Error('policy bundle needs { rules, salt }');
    return b;
  }

  // Resolve the owner's global-private bundle, if any (option, else
  // CLEVERCON_GLOBAL_POLICY_JSON). Null when no global-private is set.
  function resolveGlobalBundle(): PolicyBundle | null {
    const b = options.globalBundle ?? parseBundleEnv('CLEVERCON_GLOBAL_POLICY_JSON');
    if (!b) return null;
    if (!b.rules || !b.salt) throw new Error('global bundle needs { rules, salt }');
    return b;
  }

  function parseBundleEnv(key: string): PolicyBundle | null {
    const raw = env(key);
    return raw ? (JSON.parse(raw) as PolicyBundle) : null;
  }

  function resolvePrivateArtifacts(): {
    wasmPath: string;
    zkeyPath: string;
    poseidon?: PoseidonArtifacts;
  } {
    if (options.proverArtifacts) return options.proverArtifacts;
    const wasmPath = env('CLEVERCON_PP2_WASM');
    const zkeyPath = env('CLEVERCON_PP2_ZKEY');
    if (!wasmPath || !zkeyPath) {
      throw new Error(
        'disbursePrivate: set options.proverArtifacts or CLEVERCON_PP2_WASM + CLEVERCON_PP2_ZKEY',
      );
    }
    return { wasmPath, zkeyPath };
  }

  return {
    // pp/1 (managed server-path) is RETIRED - the verifier only carries the pp/2 batch
    // VK, so server-built binding proofs no longer verify. Fail fast with guidance
    // rather than round-tripping to a 410. Self-custody private spend -> disbursePrivate.
    pay: async () => retiredServerPath(),
    disburse: async () => retiredServerPath(),
    disbursePrivate: async (lines) => {
      const bundle = resolveBundle();
      const globalBundle = resolveGlobalBundle();
      const artifacts = resolvePrivateArtifacts();
      // Lazily pull in the prover (snarkjs/stellar) only when actually proving, so
      // importing createSpender stays dependency-free.
      const { buildPrivateDisbursement, commitmentForBundle } =
        await import('./payments/private-disburse.js');
      type Accum = {
        runningSpend: string;
        priorCount: string;
        anchorR2: string;
        anchorR7: string;
      };
      const payLines = lines.map((l) => ({ payee: l.payee, amount: l.amount }));
      const readAccum = (c: string) => request<Accum>('GET', `/vault/accumulator/${c}`);

      // Read the vault's per-commitment R2/R7 accumulator so the proof binds to the
      // window state the vault re-derives at settlement (cumulative across tasks).
      const commitment = await commitmentForBundle(bundle, artifacts);
      const {
        request: batchRequest,
        totalUsdc,
        commitmentHex,
      } = await buildPrivateDisbursement(bundle, payLines, artifacts, await readAccum(commitment));

      // A global-private rule means the vault requires a SECOND proof over the same
      // payees/amounts against the global commitment (its own window + nullifiers).
      let global:
        | {
            commitment: string;
            nullifiers: string[];
            resetR2: boolean;
            resetR7: boolean;
            proof: { a: string; b: string; c: string };
          }
        | undefined;
      if (globalBundle) {
        const gCommitment = await commitmentForBundle(globalBundle, artifacts);
        const g = await buildPrivateDisbursement(
          globalBundle,
          payLines,
          artifacts,
          await readAccum(gCommitment),
        );
        global = {
          commitment: g.request.commitment,
          nullifiers: g.request.nullifiers,
          resetR2: g.request.resetR2,
          resetR7: g.request.resetR7,
          proof: g.request.proof,
        };
      }

      const resp = await request<{ txHash: string }>('POST', '/vault/batch-release-keyless', {
        ...batchRequest,
        ...(global ? { global } : {}),
      });
      return { txHash: resp.txHash, totalUsdc, legs: lines.length, commitment: commitmentHex };
    },
    sessionPay: (payee, amount) =>
      request<{ txHash: string }>('POST', '/vault/session/pay', { payee, amount }),
    getSession: () => request<unknown>('GET', '/vault/session'),
    hire: (opts) =>
      request<Spend>('POST', '/tasks', {
        title: opts.title,
        mode: opts.mode ?? 'DIRECT',
        budget: opts.budget,
        ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
        ...(opts.policyId ? { policyId: opts.policyId } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      }),
    getBudget: () => request<Budget>('GET', '/vault'),
    getActivity: () => request<unknown>('GET', '/activity'),
    setLimit: (limit) => {
      const { isPrivate, ...rules } = limit;
      return request<SavedLimit>('POST', '/policies', { rules, isPrivate: isPrivate === true });
    },
    listLimits: () => request<{ items: SavedLimit[]; total: number }>('GET', '/policies'),
  };
}
