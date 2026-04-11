import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.ANALYSIS_AGENT_PORT || '4004';
const SELF_URL = process.env.ANALYSIS_AGENT_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.ANALYSIS_AGENT_SECRET_KEY!;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'analysis-agent',
    name: 'AnalysisBot',
    description: 'Claude-powered data analysis using MPP pay-per-chunk. Identifies trends, risks, and insights from structured data.',
    capabilities: ['data-analysis', 'comparison', 'trend-analysis', 'sentiment-analysis', 'risk-assessment'],
    pricing: { model: 'mpp', price_per_call: 0.005, currency: 'USDC' },
    endpoint: `${SELF_URL}/analyze`,
    stellar_address: keypair.publicKey(),
    health_check: `${SELF_URL}/health`,
  };

  try {
    const res = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    if (res.ok) {
      console.log(`[AnalysisBot] Registered with registry at ${REGISTRY_URL}`);
    } else {
      console.warn(`[AnalysisBot] Registry responded ${res.status}`);
    }
  } catch {
    console.warn('[AnalysisBot] Registry unavailable, retrying in 5s...');
    setTimeout(registerSelf, 5000);
  }
}
