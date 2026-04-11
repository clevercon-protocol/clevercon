import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { getBlockchainNews } from './news.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_V2_PORT || process.env.PORT || '4003');
const SECRET_KEY = process.env.WEB_INTEL_V2_SECRET_KEY!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';

if (!SECRET_KEY) {
  console.error('[WebIntelligenceV2] WEB_INTEL_V2_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const PAY_TO = keypair.publicKey();

// ── x402 setup ────────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(cors());
app.use(express.json());

// ── Unpaid endpoints ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelligenceV2', address: PAY_TO });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelligenceV2',
    description: 'Blockchain news from xlm402.com — raw data, no post-processing. Cheaper than v1.',
    capabilities: ['news', 'web-search', 'blockchain-news'],
    pricing: { model: 'x402', price_per_call: 0.015, currency: 'USDC' },
    stellar_address: PAY_TO,
  });
});

// ── x402 payment middleware ───────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      'POST /query': {
        accepts: { scheme: 'exact', price: '$0.015', network: NETWORK, payTo: PAY_TO },
        description: 'Blockchain news — raw data feed',
      },
    },
    resourceServer,
    undefined, undefined, true,
  )
);

// ── Paid endpoint — simpler than v1, no Claude post-processing ────
app.post('/query', async (req, res) => {
  try {
    const news = await getBlockchainNews();

    const inner = news.data?.data;
    const articles = inner?.stories || inner?.articles || (Array.isArray(inner) ? inner : []);

    res.json({
      result: {
        articles: Array.isArray(articles) ? articles.slice(0, 10) : [],
        article_count: Array.isArray(articles) ? articles.length : 0,
        category: 'blockchain',
        note: 'Raw data — no post-processing (v2)',
      },
      agent: 'WebIntelligenceV2',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelligenceV2] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelligenceV2] Running on port ${PORT} | Wallet: ${PAY_TO}`);
  registerSelf();
});
