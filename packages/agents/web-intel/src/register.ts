import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.WEB_INTEL_PORT || '4002';
const SELF_URL = process.env.WEB_INTEL_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'web-intel-v1',
    name: 'WebIntelligence',
    description: 'Fetches real news across blockchain, tech, and AI categories via xlm402.com x402 services. Extracts key points using Claude.',
    capabilities: ['news', 'web-search', 'web-scraping', 'information-retrieval', 'blockchain-news', 'tech-news'],
    pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
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
      console.log(`[WebIntelligence] Registered with registry at ${REGISTRY_URL}`);
    } else {
      console.warn(`[WebIntelligence] Registry responded ${res.status}`);
    }
  } catch {
    console.warn('[WebIntelligence] Registry unavailable, retrying in 5s...');
    setTimeout(registerSelf, 5000);
  }
}
