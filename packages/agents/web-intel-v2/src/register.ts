import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.WEB_INTEL_V2_PORT || '4003';
const SELF_URL = process.env.WEB_INTEL_V2_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.WEB_INTEL_V2_SECRET_KEY!;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'web-intel-v2',
    name: 'WebIntelligenceV2',
    description: 'Fetches blockchain news from xlm402.com. Simpler and cheaper than v1 — raw data, no post-processing.',
    capabilities: ['news', 'web-search', 'blockchain-news'],
    pricing: { model: 'x402', price_per_call: 0.015, currency: 'USDC' },
    endpoint: `${SELF_URL}/query`,
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
      console.log(`[WebIntelligenceV2] Registered with registry at ${REGISTRY_URL}`);
    } else {
      console.warn(`[WebIntelligenceV2] Registry responded ${res.status}`);
    }
  } catch {
    console.warn('[WebIntelligenceV2] Registry unavailable, retrying in 5s...');
    setTimeout(registerSelf, 5000);
  }
}
