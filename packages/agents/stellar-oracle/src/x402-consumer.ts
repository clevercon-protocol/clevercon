/**
 * x402 CLIENT — Stellar Oracle pays xlm402.com for external market data.
 * This is the "agent paying a service" half of the multi-layer economy.
 */
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const SECRET_KEY = process.env.STELLAR_ORACLE_SECRET_KEY!;
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const XLM402_BASE = process.env.XLM402_BASE_URL || 'https://xlm402.com';

// Build an x402-aware fetch using the Oracle's own wallet
function buildPayingFetch() {
  const signer = createEd25519Signer(SECRET_KEY);
  const scheme = new ExactStellarScheme(signer);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: scheme }],
  });
}

export interface X402Result {
  data: any;
  payment: { tx_hash: string | null; amount_paid: string } | null;
}

async function makeX402Request(url: string, options: RequestInit = {}): Promise<X402Result> {
  const payingFetch = buildPayingFetch();
  const response = await payingFetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }

  // Extract settlement info from response header
  const paymentHeader = response.headers.get('x-payment-response');
  let payment: X402Result['payment'] = null;
  if (paymentHeader) {
    try {
      const decoded = decodePaymentResponseHeader(paymentHeader);
      payment = {
        tx_hash: (decoded as any)?.txHash ?? null,
        amount_paid: (decoded as any)?.amount ?? 'unknown',
      };
    } catch {
      payment = { tx_hash: null, amount_paid: 'unknown' };
    }
  }

  const data = await response.json();
  return { data, payment };
}

export async function getCryptoQuote(symbol = 'XLM-USD'): Promise<X402Result> {
  const url = `${XLM402_BASE}/testnet/markets/crypto/quote?symbol=${encodeURIComponent(symbol)}`;
  return makeX402Request(url);
}

export async function getCryptoCandles(symbol = 'XLM-USD'): Promise<X402Result> {
  const url = `${XLM402_BASE}/testnet/markets/crypto/candles?symbol=${encodeURIComponent(symbol)}`;
  return makeX402Request(url);
}
