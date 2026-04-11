/**
 * MPP payment client for the orchestrator.
 * Orchestrator pays the Analysis agent (and any future MPP agents) via MPP.
 *
 * Accepts a secretKey parameter so each user's personal orchestrator keypair
 * is used (U5). Falls back to ORCHESTRATOR_SECRET_KEY env var if not provided.
 */
import { Mppx } from 'mppx/client';
import { stellar } from '@stellar/mpp/charge/client';

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
