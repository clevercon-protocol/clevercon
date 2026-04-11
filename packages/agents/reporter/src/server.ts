import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { generateReport } from './report.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.REPORT_AGENT_PORT || process.env.PORT || '4005');
const SECRET_KEY = process.env.REPORT_AGENT_SECRET_KEY!;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';
const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';

if (!SECRET_KEY) {
  console.error('[ReporterBot] REPORT_AGENT_SECRET_KEY not set');
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
  res.json({ status: 'ok', agent: 'ReporterBot', address: PAY_TO });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'ReporterBot',
    description: 'Claude-powered report formatter. Converts data and analysis into structured markdown reports.',
    capabilities: ['report-writing', 'formatting', 'summarization', 'document-generation'],
    pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: PAY_TO,
  });
});

// ── x402 payment middleware ───────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      'POST /report': {
        accepts: {
          scheme: 'exact',
          price: '$0.02',
          network: NETWORK,
          payTo: PAY_TO,
        },
        description: 'Generate a structured markdown report from data',
      },
    },
    resourceServer,
    undefined,
    undefined,
    true,
  )
);

// ── Paid endpoint ─────────────────────────────────────────────────
app.post('/report', async (req, res) => {
  try {
    const { data, sections, title = 'Report', query, context } = req.body;

    let reportInput: any;
    if (sections && Array.isArray(sections)) {
      reportInput = { title, sections };
    } else if (data) {
      reportInput = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } else if (query || context) {
      // Orchestrator-style: combine query + context into a raw string
      const combined = [query, context].filter(Boolean).join('\n\n');
      reportInput = combined;
    } else {
      res.status(400).json({ error: 'Provide either data (string/object) or sections (array of {title, content})' });
      return;
    }

    const report = await generateReport(reportInput);
    res.json({ result: report, agent: 'ReporterBot', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[ReporterBot] Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ReporterBot] Running on port ${PORT} | Wallet: ${PAY_TO} | Payment: x402`);
  registerSelf();
});
