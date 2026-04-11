/**
 * Pays xlm402.com to scrape/extract web page content via x402.
 */
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';

export async function scrapeUrl(targetUrl: string): Promise<{ data: any; paid: boolean }> {
  const signer = createEd25519Signer(SECRET_KEY);
  const scheme = new ExactStellarScheme(signer);
  const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: scheme }],
  });

  const response = await payingFetch(`${XLM402_BASE}/testnet/scrape/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl }),
  });

  if (!response.ok) throw new Error(`Scrape failed: ${response.status}`);
  const data = await response.json();
  return { data, paid: true };
}
