import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.STELLAR_ORACLE_PORT || '4001';
const SELF_URL = process.env.STELLAR_ORACLE_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.STELLAR_ORACLE_SECRET_KEY!;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'stellar-oracle',
    name: 'StellarOracle',
    description: 'Reads live Stellar blockchain data via Horizon API — DEX trades, orderbooks, account balances, network stats, and cross-exchange crypto prices.',
    capabilities: ['blockchain-data', 'crypto-prices', 'stellar-dex', 'orderbook', 'network-stats', 'market-data'],
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
      console.log(`[StellarOracle] Registered with registry at ${REGISTRY_URL}`);
    } else {
      console.warn(`[StellarOracle] Registry responded ${res.status}`);
    }
  } catch {
    console.warn('[StellarOracle] Registry unavailable, retrying in 5s...');
    setTimeout(registerSelf, 5000);
  }
}
