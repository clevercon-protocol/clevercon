import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { Mppx } from 'mppx/server';
import { stellar } from '@stellar/mpp/charge/server';
import { USDC_SAC_TESTNET, STELLAR_TESTNET } from '@stellar/mpp';
import { analyzeWithClaude } from './analyze.js';
import { registerSelf } from './register.js';
import { validateEnvOrExit } from '@clevercon/common';

if (!process.env.VITEST) {
  validateEnvOrExit('analysis', {
    REGISTRY_URL: { type: 'url' },
    ANALYSIS_AGENT_SECRET_KEY: { type: 'stellarSecret' },
  });
}

const PORT = parseInt(process.env.ANALYSIS_AGENT_PORT || process.env.PORT || '4004');
const SECRET_KEY = process.env.ANALYSIS_AGENT_SECRET_KEY!;

const keypair = Keypair.fromSecret(SECRET_KEY);
const PAY_TO = keypair.publicKey();

// ── MPP setup — lazy so a Soroban RPC hiccup at startup doesn't kill the process
function createMppx() {
  return Mppx.create({
    methods: [
      stellar({
        recipient: PAY_TO,
        currency: USDC_SAC_TESTNET,
        network: STELLAR_TESTNET,
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    ],
    secretKey: SECRET_KEY,
    realm: 'clevercon-analysis',
  });
}

let _mppx: ReturnType<typeof createMppx> | null = null;
function getMppx() {
  if (!_mppx) {
    _mppx = createMppx();
  }
  return _mppx;
}

const app = express();
app.use(cors());
app.use(express.json());

// ── Unpaid endpoints ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'AnalysisBot', address: PAY_TO, payment: 'MPP' });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'AnalysisBot',
    description: 'Claude-powered trend analysis and risk assessment via MPP',
    capabilities: [
      'data-analysis',
      'comparison',
      'trend-analysis',
      'sentiment-analysis',
      'risk-assessment',
    ],
    pricing: { model: 'mpp', price_per_call: 0.005, currency: 'USDC' },
    stellar_address: PAY_TO,
  });
});

// ── MPP-protected endpoint ────────────────────────────────────────
app.post('/analyze', async (req, res) => {
  // Build a Fetch API Request from the Express request (required by MPP SDK)
  const protocol = 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.originalUrl}`;

  const fetchReq = new Request(url, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
    ),
    body: JSON.stringify(req.body),
  });

  // Run MPP charge handler
  const stellarCharge = getMppx()['stellar/charge'];
  const result = await stellarCharge({
    amount: '0.005',
    currency: USDC_SAC_TESTNET,
    recipient: PAY_TO,
    description: 'Data analysis chunk - CleverCon',
  })(fetchReq);

  if (result.status === 402) {
    // Send MPP challenge back to client
    const challenge = result.challenge;
    res.status(402);
    challenge.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    res.json(await challenge.json());
    return;
  }

  // Payment verified — run Claude analysis then attach receipt
  try {
    const {
      data = '',
      instruction = 'Analyze this data and identify key trends, risks, and insights.',
    } = req.body;
    const analysis = await analyzeWithClaude(
      typeof data === 'string' ? data : JSON.stringify(data),
      instruction,
    );
    const body = JSON.stringify({
      result: analysis,
      agent: 'AnalysisBot',
      timestamp: new Date().toISOString(),
    });
    const receiptResult = result.withReceipt(
      new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    );
    const finalResponse = (receiptResult as any).response ?? receiptResult;
    if (finalResponse?.headers?.forEach) {
      finalResponse.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    }
    res.json({ result: analysis, agent: 'AnalysisBot', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[AnalysisBot] Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[AnalysisBot] Running on port ${PORT} | Wallet: ${PAY_TO} | Payment: MPP`);
  registerSelf();
});
