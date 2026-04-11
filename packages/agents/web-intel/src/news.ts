/**
 * Fetches real news from xlm402.com via x402 payments.
 * Web Intel v1 pays for multiple categories and extracts key points.
 */
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';

function buildPayingFetch() {
  const signer = createEd25519Signer(SECRET_KEY);
  const scheme = new ExactStellarScheme(signer);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: scheme }],
  });
}

async function fetchNews(path: string): Promise<{ data: any; paid: boolean }> {
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const payingFetch = buildPayingFetch(); // fresh signer per attempt
    try {
      const response = await payingFetch(`${XLM402_BASE}${path}`);
      if (!response.ok) throw new Error(`xlm402 ${path} failed: ${response.status}`);
      const data = await response.json();
      return { data, paid: true };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError!;
}

export async function getBlockchainNews() {
  return fetchNews('/testnet/news/blockchain');
}

export async function getTechNews() {
  return fetchNews('/testnet/news/tech');
}

export async function getAINews() {
  return fetchNews('/testnet/news/ai');
}
