/**
 * Web Intel v2 — fetches only blockchain news, no post-processing.
 * Cheaper but lower quality than v1.
 */
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const SECRET_KEY = process.env.WEB_INTEL_V2_SECRET_KEY!;
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';

export async function getBlockchainNews(): Promise<{ data: any; paid: boolean }> {
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh signer/scheme/fetch each attempt to avoid stale sequence state
    const signer = createEd25519Signer(SECRET_KEY);
    const scheme = new ExactStellarScheme(signer);
    const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: NETWORK, client: scheme }],
    });

    try {
      const response = await payingFetch(`${XLM402_BASE}/testnet/news/blockchain`);
      if (!response.ok) throw new Error(`xlm402 news failed: ${response.status}`);
      const data = await response.json();
      return { data, paid: true };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  throw lastError!;
}
