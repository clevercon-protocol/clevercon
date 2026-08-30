/**
 * Downstream x402 payments — the Oracle pays xlm402.com for external market
 * data. Uses the SDK's `createPayingFetch` instead of a hand-rolled paying fetch
 * (compare `packages/agents/stellar-oracle/src/x402-consumer.ts`).
 */
import { decodePaymentResponseHeader } from '@x402/fetch';
import { createPayingFetch } from '@clevercon/agent-sdk';

const SECRET_KEY = process.env.EXAMPLE_ORACLE_SECRET_KEY ?? '';
const NETWORK = process.env.STELLAR_NETWORK ?? 'stellar:testnet';
const XLM402_BASE = process.env.XLM402_BASE_URL ?? 'https://xlm402.com';

export interface X402Result {
  data: unknown;
  payment: { tx_hash: string | null; amount_paid: string } | null;
}

async function makeX402Request(url: string): Promise<X402Result> {
  const payingFetch = createPayingFetch({ secretKey: SECRET_KEY, network: NETWORK });
  const response = await payingFetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }

  let payment: X402Result['payment'] = null;
  const paymentHeader = response.headers.get('x-payment-response');
  if (paymentHeader) {
    try {
      const decoded = decodePaymentResponseHeader(paymentHeader) as Record<string, unknown>;
      payment = {
        tx_hash: (decoded?.txHash as string) ?? null,
        amount_paid: (decoded?.amount as string) ?? 'unknown',
      };
    } catch {
      payment = { tx_hash: null, amount_paid: 'unknown' };
    }
  }

  return { data: await response.json(), payment };
}

export function getCryptoQuote(symbol = 'XLM-USD'): Promise<X402Result> {
  return makeX402Request(
    `${XLM402_BASE}/testnet/markets/crypto/quote?symbol=${encodeURIComponent(symbol)}`,
  );
}

export function getCryptoCandles(symbol = 'XLM-USD'): Promise<X402Result> {
  return makeX402Request(
    `${XLM402_BASE}/testnet/markets/crypto/candles?symbol=${encodeURIComponent(symbol)}`,
  );
}
