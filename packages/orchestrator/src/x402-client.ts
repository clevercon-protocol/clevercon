/**
 * x402 payment client for the orchestrator.
 * Orchestrator pays worker agents (Oracle, WebIntel, Reporter) via x402.
 *
 * Accepts a secretKey parameter so each user's personal orchestrator keypair
 * is used (U5). Falls back to ORCHESTRATOR_SECRET_KEY env var if not provided.
 *
 * Uses a fresh signer per call — ExactStellarScheme signs a Stellar transaction
 * at call time, so a cached scheme can produce stale/reused sequence numbers
 * on subsequent calls.
 */
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const NETWORK = (process.env.STELLAR_NETWORK || 'stellar:testnet') as `${string}:${string}`;
const MAX_ATTEMPTS = 3;

function buildPayingFetch(secretKey: string): typeof fetch {
  const signer = createEd25519Signer(secretKey);
  const scheme = new ExactStellarScheme(signer);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: scheme }],
  }) as typeof fetch;
}

export interface X402Result {
  output: string;
  tx_hash: string | null;
}

/**
 * Call an x402-protected agent endpoint, paying automatically.
 * Retries up to MAX_ATTEMPTS times with a fresh signer each time.
 *
 * @param endpoint  Full URL, e.g. http://localhost:4001/query
 * @param action    Instruction string for the agent
 * @param context   Output from previous steps to pass as context
 * @param secretKey Secret key to sign payments (defaults to ORCHESTRATOR_SECRET_KEY)
 */
export async function makeX402Payment(
  endpoint: string,
  action: string,
  context?: string,
  secretKey?: string,
): Promise<X402Result> {
  const key = secretKey ?? process.env.ORCHESTRATOR_SECRET_KEY!;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh signer + scheme on every attempt — avoids stale sequence numbers
    const payingFetch = buildPayingFetch(key);

    try {
      const response = await payingFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: action, context: context ?? '' }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Agent returned ${response.status}: ${text}`);
      }

      // Extract transaction hash from x402 settlement header
      let tx_hash: string | null = null;
      try {
        const paymentHeader =
          response.headers.get('payment-response') ||
          response.headers.get('x-payment-response') ||
          response.headers.get('PAYMENT-RESPONSE') ||
          response.headers.get('X-PAYMENT-RESPONSE');
        if (paymentHeader) {
          const decoded = decodePaymentResponseHeader(paymentHeader);
          tx_hash = (decoded as any)?.transaction ?? (decoded as any)?.txHash ?? null;
        }
      } catch {
        // Hash extraction is best-effort
      }

      const data = await response.json();
      const output = typeof data.result === 'string'
        ? data.result
        : JSON.stringify(data.result ?? data);

      return { output, tx_hash };

    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 2000 * attempt;
        console.warn(`[x402-client] Attempt ${attempt} failed for ${endpoint}: ${err.message} — retrying in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError!;
}
