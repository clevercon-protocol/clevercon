/**
 * StellarOracle, rebuilt on `@clevercon/agent-sdk`.
 *
 * Behavioural parity with `packages/agents/stellar-oracle`: same manifest, same
 * `/health` and `/` shapes, same `POST /query` contract and x402 paywall, same
 * `/cache/stats` route, same downstream x402 payments to xlm402.com. The SDK
 * supplies everything the hand-written `server.ts` + `register.ts` did.
 */
import 'dotenv/config';
import { createAgent, type AgentTask } from '@clevercon/agent-sdk';
import {
  getXLMUSDCTrades,
  getOrderbook,
  getAssetMetadata,
  getAccountBalances,
  getNetworkStats,
} from './horizon.js';
import { getCacheStats } from './cache.js';
import { getCryptoQuote, getCryptoCandles } from './xlm402.js';

const SECRET_KEY = process.env.EXAMPLE_ORACLE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('[StellarOracle] EXAMPLE_ORACLE_SECRET_KEY not set');
  process.exit(1);
}

async function handleQuery(task: AgentTask): Promise<Record<string, unknown>> {
  const query = task.query;
  const q = query.toLowerCase();

  const wantsTrades =
    q.includes('trade') ||
    q.includes('price') ||
    q.includes('xlm') ||
    q.includes('market') ||
    q === '';
  const wantsOrderbook =
    q.includes('order') || q.includes('book') || q.includes('bid') || q.includes('ask') || q === '';
  const wantsNetwork =
    q.includes('network') || q.includes('ledger') || q.includes('stats') || q === '';
  const wantsBalances = q.includes('balance') || q.includes('account');
  const wantsAssetMetadata =
    q.includes('asset') || q.includes('issuer') || q.includes('metadata') || q === '';
  const wantsCandles = q.includes('candle') || q.includes('ohlc') || q.includes('chart');

  const symbolMatch = query.match(/\b(BTC|ETH|SOL|XLM|XRP)-USD\b/i);
  const symbol = symbolMatch ? symbolMatch[0].toUpperCase() : 'XLM-USD';

  const [trades, orderbook, assetMetadata, networkStats, externalQuote, externalCandles] =
    await Promise.all([
      wantsTrades ? getXLMUSDCTrades(10) : Promise.resolve(null),
      wantsOrderbook ? getOrderbook() : Promise.resolve(null),
      wantsAssetMetadata ? getAssetMetadata() : Promise.resolve(null),
      wantsNetwork ? getNetworkStats() : Promise.resolve(null),
      wantsTrades || q === '' ? getCryptoQuote(symbol).catch(() => null) : Promise.resolve(null),
      wantsCandles ? getCryptoCandles(symbol).catch(() => null) : Promise.resolve(null),
    ]);

  let balances = null;
  if (wantsBalances) {
    const addressMatch = query.match(/G[A-Z0-9]{55}/);
    if (addressMatch) balances = await getAccountBalances(addressMatch[0]);
  }

  const result: Record<string, unknown> = { query, timestamp: new Date().toISOString() };
  if (trades) result.stellar_dex_trades = trades;
  if (orderbook) result.stellar_dex_orderbook = orderbook;
  if (assetMetadata) result.asset_metadata = assetMetadata;
  if (networkStats) result.network_stats = networkStats;
  if (balances) result.account_balances = balances;
  if (externalQuote) result.cross_exchange_price = externalQuote.data;
  if (externalCandles) result.price_candles = externalCandles.data;

  const payments_made = [externalQuote?.payment, externalCandles?.payment].filter(Boolean);
  if (payments_made.length > 0) result.payments_made = payments_made;

  return result;
}

export const agent = createAgent({
  manifest: {
    agent_id: 'stellar-oracle',
    name: 'StellarOracle',
    description:
      'Reads live Stellar blockchain data via Horizon API — DEX trades, orderbooks, account balances, network stats, and cross-exchange crypto prices.',
  },
  capabilities: [
    'blockchain-data',
    'crypto-prices',
    'stellar-dex',
    'orderbook',
    'network-stats',
    'market-data',
  ],
  price: 0.02,
  payment: 'x402',
  wallet: { secretKey: SECRET_KEY },
  port: Number(process.env.EXAMPLE_ORACLE_PORT ?? process.env.PORT ?? 4001),
  taskPath: '/query',
  routes: (app) => {
    app.get('/cache/stats', (_req, res) => res.json(getCacheStats()));
  },
  handler: (task) => handleQuery(task),
});

if (process.env.NODE_ENV !== 'test') {
  agent.listen();
}
