/**
 * Agent-key mode: an autonomous agent that funds itself from a CleverCon vault
 * (governed, non-custodial) and pays external x402 services with those funds.
 *
 * The vault owner grants a scoped API key and sets a spending limit; the agent
 * holds its OWN Stellar key (the platform never sees it). Both legs settle in the
 * same USDC, so no swap is needed.
 *
 *   CLEVERCON_API_KEY=cc_...  AGENT_SECRET_KEY=S...  \
 *   ORACLE_URL=http://localhost:4001/query           \
 *   npx tsx examples/x402-agent/agent.ts
 */
import { createAgentWallet } from '@clevercon/agent-sdk';

const API_KEY = process.env.CLEVERCON_API_KEY;
const SECRET_KEY = process.env.AGENT_SECRET_KEY;
const ORACLE_URL = process.env.ORACLE_URL ?? 'http://localhost:4001/query';

if (!API_KEY || !SECRET_KEY) {
  console.error('Set CLEVERCON_API_KEY (cc_...) and AGENT_SECRET_KEY (S...).');
  process.exit(1);
}

async function main() {
  const wallet = createAgentWallet({
    apiKey: API_KEY!,
    secretKey: SECRET_KEY!,
    apiUrl: process.env.CLEVERCON_API_URL, // defaults to http://localhost:4100
    network: process.env.STELLAR_NETWORK, // defaults to stellar:testnet
  });
  console.log('agent wallet:', wallet.address);

  // 1. See how much the owner still lets this agent pull.
  const budget = await wallet.getBudget();
  console.log('vault budget available to pull:', budget.available, 'USDC');

  // 2. Pull working capital into the agent's own wallet. Bounded on-chain by the
  //    owner's policy; the release settles asynchronously, so give it a moment.
  const topUp = await wallet.topUp(0.1, { reason: 'top up for market data' });
  console.log('top-up spend:', topUp.id, topUp.status);
  await new Promise((r) => setTimeout(r, 12_000));

  // 3. Spend it autonomously on an external x402 service. Each 402 challenge is
  //    settled transparently with the agent's own key.
  const res = await wallet.fetch(ORACLE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'xlm price' }),
  });
  console.log('x402 service status:', res.status);
  console.log('x402 service data:', await res.text());
}

main().catch((e) => {
  console.error('agent failed:', e?.message ?? e);
  process.exit(1);
});
