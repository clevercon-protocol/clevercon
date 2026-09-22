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

export interface SpenderOptions {
  /** Scoped API key (cc_...). */
  apiKey: string;
  /** API base URL. Defaults to CLEVERCON_API_URL or http://localhost:4100. */
  apiUrl?: string;
  /** Override fetch (for tests or a custom agent). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
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

export interface CleverConClient {
  /** Pay a single address, bounded by a saved limit or one derived from the payment.
   *  Pass `idempotencyKey` so a retried call (e.g. after a timeout) returns the
   *  original spend instead of paying twice. */
  pay(
    payee: string,
    amount: number,
    opts?: { reason?: string; policyId?: string; idempotencyKey?: string },
  ): Promise<Spend>;
  /** Disburse to many addresses in one bounded instruction. `idempotencyKey` makes
   *  a retry return the original spend rather than disbursing twice. */
  disburse(
    lines: PaymentLine[],
    opts?: { policyId?: string; idempotencyKey?: string },
  ): Promise<Spend>;
  /** Hire a registered service (DIRECT pays a chosen serviceId). */
  hire(opts: {
    title: string;
    budget: number;
    serviceId?: string;
    mode?: 'DIRECT' | 'SEARCH' | 'COMPOSE';
    policyId?: string;
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
    'http://localhost:4100'
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

  return {
    pay: (payee, amount, opts) =>
      request<Spend>('POST', '/payments', {
        kind: 'pay',
        lines: [{ payee, amount, ...(opts?.reason ? { reason: opts.reason } : {}) }],
        ...(opts?.policyId ? { policyId: opts.policyId } : {}),
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      }),
    disburse: (lines, opts) =>
      request<Spend>('POST', '/payments', {
        kind: 'disburse',
        lines,
        ...(opts?.policyId ? { policyId: opts.policyId } : {}),
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      }),
    hire: (opts) =>
      request<Spend>('POST', '/tasks', {
        title: opts.title,
        mode: opts.mode ?? 'DIRECT',
        budget: opts.budget,
        ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
        ...(opts.policyId ? { policyId: opts.policyId } : {}),
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
