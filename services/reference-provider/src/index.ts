import { createProvider } from '@clevercon/agent-sdk/provider';
import { Horizon, Asset } from '@stellar/stellar-sdk';

/**
 * Reference provider: a real, hireable Stellar market-data oracle, built on the
 * SDK's createProvider. It is the canonical example of the fulfillment contract
 * AND it returns genuinely useful live data (not an echo), so a buyer's hire
 * produces a real result and, when the task is on-chain-locked, the provider is
 * paid on settlement.
 *
 * The work here is live Horizon data (public, no API key): latest ledger stats
 * (always available) plus a best-effort XLM/USDC spot price from recent DEX
 * trades. A real provider would do its own job here; the rail is identical.
 */
const PORT = Number(process.env.PROVIDER_PORT ?? 4200);
const NAME = process.env.PROVIDER_NAME ?? 'stellar-market-oracle';
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const USDC_ISSUER =
  process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const server = new Horizon.Server(HORIZON_URL);
const USDC = new Asset('USDC', USDC_ISSUER);

/** Latest ledger stats. Always available on testnet, so the result is never empty. */
async function networkStats() {
  const ledger = await server.ledgers().limit(1).order('desc').call();
  const latest = ledger.records[0];
  return {
    latest_ledger: latest.sequence,
    base_fee_stroops: latest.base_fee_in_stroops,
    closed_at: latest.closed_at,
  };
}

/** Best-effort XLM/USDC spot price from the most recent DEX trade. */
async function xlmUsdcPrice(): Promise<{ pair: string; price: string | null; at: string | null }> {
  try {
    const trades = await server
      .trades()
      .forAssetPair(Asset.native(), USDC)
      .limit(1)
      .order('desc')
      .call();
    const t = trades.records[0];
    const price =
      t?.price?.n && t?.price?.d ? (Number(t.price.n) / Number(t.price.d)).toFixed(6) : null;
    return { pair: 'XLM/USDC', price, at: t?.ledger_close_time ?? null };
  } catch {
    return { pair: 'XLM/USDC', price: null, at: null };
  }
}

const provider = createProvider({
  name: NAME,
  port: PORT,
  async fulfill({ action, taskId }) {
    const [network, market] = await Promise.all([networkStats(), xlmUsdcPrice()]);
    return {
      provider: NAME,
      action,
      taskId,
      network,
      market,
      at: new Date().toISOString(),
    };
  },
});

provider.listen(PORT);
