/**
 * MPP payment client for the orchestrator.
 * Orchestrator pays the Analysis agent (and any future MPP agents) via MPP.
 *
 * Accepts a secretKey parameter so each user's personal orchestrator keypair
 * is used (U5). Falls back to ORCHESTRATOR_SECRET_KEY env var if not provided.
 */
import { Mppx } from 'mppx/client';
import { stellar } from '@stellar/mpp/charge/client';

const MAX_MPP_RETRIES = parseInt(process.env.MAX_MPP_RETRIES || '3', 10);
const MPP_RETRY_BASE_MS = parseInt(process.env.MPP_RETRY_BASE_MS || '500', 10);

async function withFetchRetry(
  fn: () => Promise<Response>,
  actionName: string,
  maxAttempts: number,
  baseDelayMs: number,
  retryOn5xx: boolean
): Promise<Response> {
  let attempt = 1;
  while (true) {
    try {
      const response = await fn();

      if (retryOn5xx && response.status >= 500 && response.status < 600) {
        if (attempt >= maxAttempts) {
          return response;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[mpp] ${actionName} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms.`
      );
      await new Promise((r) => setTimeout(r, delayMs));
      attempt++;
    }
  }
}

const customFetch: typeof fetch = async (input, init) => {
  let urlStr = '';
  let method = init?.method?.toUpperCase() || 'GET';

  // Safely extract the URL string and method without assuming global Request/URL types
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input && typeof input === 'object') {
    if ('url' in input && typeof input.url === 'string') {
      urlStr = input.url;
    } else if ('href' in input && typeof input.href === 'string') {
      urlStr = input.href;
    } else {
      urlStr = input.toString();
    }
    
    if (!init?.method && 'method' in input && typeof input.method === 'string') {
      method = input.method.toUpperCase();
    }
  }

  if (method === 'POST') {
    if (urlStr.endsWith('/session/start')) {
      return withFetchRetry(() => fetch(input, init), 'session start', MAX_MPP_RETRIES, MPP_RETRY_BASE_MS, true);
    }
    if (urlStr.endsWith('/session/end')) {
      return withFetchRetry(() => fetch(input, init), 'session end', 2, MPP_RETRY_BASE_MS, false);
    }
  }
  return fetch(input, init);
};

// Build a fresh MPP fetch per call — MPP payment channels are stateful;
// reusing a cached instance across calls can produce stale channel state.
function buildMPPFetch(secretKey: string): typeof fetch {
  const mppx = Mppx.create({
    methods: [
      stellar({
        secretKey,
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    ],
    polyfill: false,
    fetch: customFetch,
  });
  return mppx.fetch as typeof fetch;
}

export interface MPPResult {
  output: string;
  tx_hash: string | null;
}

/**
 * Call an MPP-protected agent endpoint, paying automatically.
 * @param endpoint    Full URL, e.g. http://localhost:4004/analyze
 * @param data        Arbitrary payload object to POST
 * @param instruction Instruction/query for the agent
 * @param secretKey   Secret key to sign payments (defaults to ORCHESTRATOR_SECRET_KEY)
 */
export async function makeMPPPayment(
  endpoint: string,
  data: Record<string, unknown>,
  instruction: string,
  secretKey?: string,
): Promise<MPPResult> {
  const key = secretKey ?? process.env.ORCHESTRATOR_SECRET_KEY!;
  const mppFetch = buildMPPFetch(key);

  const response = await mppFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, instruction }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`MPP agent returned ${response.status}: ${text}`);
  }

  // Extract transaction hash from MPP receipt header
  let tx_hash: string | null = null;
  try {
    const receiptHeader =
      response.headers.get('x-payment-receipt') ||
      response.headers.get('x-mpp-receipt') ||
      response.headers.get('x-receipt');
    if (receiptHeader) {
      try {
        const parsed = JSON.parse(receiptHeader);
        tx_hash = parsed?.txHash ?? parsed?.hash ?? parsed?.transaction ?? null;
      } catch {
        // Treat as raw hash string if not JSON
        if (receiptHeader.length > 20) tx_hash = receiptHeader;
      }
    }
  } catch {
    // Hash extraction is best-effort
  }

  const responseData = await response.json();
  const output =
    typeof responseData.result === 'string'
      ? responseData.result
      : JSON.stringify(responseData.result ?? responseData);

  return { output, tx_hash };
}