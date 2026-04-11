import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { getXLMUSDCTrades, getOrderbook, getAccountBalances, getNetworkStats } from './horizon.js';
import { getCryptoQuote, getCryptoCandles } from './x402-consumer.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.STELLAR_ORACLE_PORT || process.env.PORT || '4001');
const SECRET_KEY = process.env.STELLAR_ORACLE_SECRET_KEY!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';

if (!SECRET_KEY) {
  console.error('[StellarOracle] STELLAR_ORACLE_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const PAY_TO = keypair.publicKey();

// ── x402 setup ───────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(cors());
app.use(express.json());

// ── Unpaid endpoints ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'StellarOracle', address: PAY_TO });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'StellarOracle',
    description: 'Live Stellar blockchain data — DEX trades, orderbooks, crypto prices',
    capabilities: ['blockchain-data', 'crypto-prices', 'stellar-dex', 'orderbook', 'network-stats', 'market-data'],
    pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: PAY_TO,
  });
});

// ── x402 payment middleware ───────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      'POST /query': {
        accepts: {
          scheme: 'exact',
          price: '$0.02',
          network: NETWORK,
          payTo: PAY_TO,
        },
        description: 'Live Stellar blockchain & market data',
      },
    },
    resourceServer,
    undefined,  // paywallConfig
    undefined,  // paywall
    true,       // syncFacilitatorOnStart
  )
);

// ── Paid endpoint ─────────────────────────────────────────────────
app.post('/query', async (req, res) => {
  try {
    const { query = '' } = req.body;
    const q = query.toLowerCase();

    const wantsTrades = q.includes('trade') || q.includes('price') || q.includes('xlm') || q.includes('market') || q === '';
    const wantsOrderbook = q.includes('order') || q.includes('book') || q.includes('bid') || q.includes('ask') || q === '';
    const wantsNetwork = q.includes('network') || q.includes('ledger') || q.includes('stats') || q === '';
    const wantsBalances = q.includes('balance') || q.includes('account');
    const wantsCandles = q.includes('candle') || q.includes('ohlc') || q.includes('chart');

    // Parse symbol from query (default XLM-USD)
    const symbolMatch = query.match(/\b(BTC|ETH|SOL|XLM|XRP)-USD\b/i);
    const symbol = symbolMatch ? symbolMatch[0].toUpperCase() : 'XLM-USD';

    // Fetch Horizon data + xlm402 external quote in parallel
    const [trades, orderbook, networkStats, externalQuote, externalCandles] = await Promise.all([
      wantsTrades ? getXLMUSDCTrades(10) : Promise.resolve(null),
      wantsOrderbook ? getOrderbook() : Promise.resolve(null),
      wantsNetwork ? getNetworkStats() : Promise.resolve(null),
      // Always fetch cross-exchange quote when price/market is requested
      (wantsTrades || q === '') ? getCryptoQuote(symbol).catch(e => {
        console.warn('[StellarOracle] xlm402 quote failed:', e.message);
        return null;
      }) : Promise.resolve(null),
      wantsCandles ? getCryptoCandles(symbol).catch(e => {
        console.warn('[StellarOracle] xlm402 candles failed:', e.message);
        return null;
      }) : Promise.resolve(null),
    ]);

    let balances = null;
    if (wantsBalances) {
      const addressMatch = query.match(/G[A-Z0-9]{55}/);
      if (addressMatch) {
        balances = await getAccountBalances(addressMatch[0]);
      }
    }

    const result: Record<string, any> = { query, timestamp: new Date().toISOString() };
    if (trades) result.stellar_dex_trades = trades;
    if (orderbook) result.stellar_dex_orderbook = orderbook;
    if (networkStats) result.network_stats = networkStats;
    if (balances) result.account_balances = balances;
    if (externalQuote) result.cross_exchange_price = externalQuote.data;
    if (externalCandles) result.price_candles = externalCandles.data;

    // Report any payments the Oracle made downstream (the multi-layer economy)
    const payments_made = [externalQuote?.payment, externalCandles?.payment].filter(Boolean);
    if (payments_made.length > 0) result.payments_made = payments_made;

    res.json({ result, agent: 'StellarOracle' });
  } catch (err: any) {
    console.error('[StellarOracle] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[StellarOracle] Running on port ${PORT} | Wallet: ${PAY_TO}`);
  registerSelf();
});
