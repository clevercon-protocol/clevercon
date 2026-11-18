/**
 * Register a hireable service in the CleverCon marketplace through the real API
 * flow (self-funded testnet provider key, SEP-10 sign-in, POST /provider/services).
 * This is how you populate the marketplace so `hire` and the Services page work.
 *
 * Usage:
 *   API_URL=https://<api> PROVIDER_ENDPOINT=https://<provider-url> npx tsx scripts/register-service.ts
 *
 * Env:
 *   API_URL            CleverCon API base (default http://localhost:4100)
 *   PROVIDER_ENDPOINT  the service's reachable endpoint the worker will call (required)
 *   PROVIDER_SECRET_KEY  reuse a provider Stellar key (default: generate + friendbot-fund one)
 *   SERVICE_NAME, SERVICE_DESCRIPTION, SERVICE_CATEGORY, SERVICE_PRICE, PRICING_MODEL
 */
import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  Horizon,
  BASE_FEE,
} from '@stellar/stellar-sdk';

const API_URL = process.env.API_URL ?? 'http://localhost:4100';
const ENDPOINT = process.env.PROVIDER_ENDPOINT;
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const USDC_ISSUER =
  process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const USDC = new Asset('USDC', USDC_ISSUER);
const horizon = new Horizon.Server(HORIZON_URL);

if (!ENDPOINT) {
  console.error(
    'PROVIDER_ENDPOINT is required (the reachable URL the CleverCon worker will POST to on hire).\n' +
      'Usage: API_URL=... PROVIDER_ENDPOINT=https://your-provider npx tsx scripts/register-service.ts',
  );
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = unknown>(
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.body ? 'POST' : 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function signXdr(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  tx.sign(kp);
  return tx.toXDR();
}

async function signIn(kp: Keypair): Promise<string> {
  const ch = await api<{ transaction: string }>('/auth/challenge', {
    body: { address: kp.publicKey() },
  });
  const signed = signXdr(ch.transaction, kp);
  const tok = await api<{ accessToken: string }>('/auth/verify', { body: { transaction: signed } });
  return tok.accessToken;
}

async function main() {
  const kp = process.env.PROVIDER_SECRET_KEY
    ? Keypair.fromSecret(process.env.PROVIDER_SECRET_KEY)
    : Keypair.random();
  console.log(`provider: ${kp.publicKey()}`);
  if (!process.env.PROVIDER_SECRET_KEY) {
    console.log(`provider secret (save this to reuse): ${kp.secret()}`);
  }

  // Fund + add a USDC trustline so the provider can be paid on settlement.
  try {
    await horizon.loadAccount(kp.publicKey());
  } catch {
    const fb = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (!fb.ok) throw new Error(`friendbot failed: ${fb.status}`);
    await sleep(2000);
  }
  const acct = await horizon.loadAccount(kp.publicKey());
  const hasUsdc = acct.balances.some(
    (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  if (!hasUsdc) {
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(120)
      .build();
    tx.sign(kp);
    await horizon.submitTransaction(tx);
    console.log('added USDC trustline');
  }

  const token = await signIn(kp);
  console.log('signed in (SEP-10)');

  const service = {
    name: process.env.SERVICE_NAME ?? 'Stellar Market Oracle',
    description:
      process.env.SERVICE_DESCRIPTION ??
      'Live Stellar market data: latest ledger stats and a best-effort XLM/USDC spot price.',
    category: process.env.SERVICE_CATEGORY ?? 'Data & Oracles',
    capabilities: ['market-data', 'price-oracle'],
    pricingModel: (process.env.PRICING_MODEL ?? 'X402') as 'X402' | 'MPP',
    pricePerCall: Number(process.env.SERVICE_PRICE ?? '0.1'),
    endpoint: ENDPOINT,
    stellarAddress: kp.publicKey(),
  };

  const created = await api<{ id: string; name: string }>('/provider/services', {
    body: service,
    token,
  });
  console.log(`\n✓ registered service "${created.name}" (id ${created.id})`);
  console.log(`  endpoint: ${service.endpoint}`);
  console.log(`  price: ${service.pricePerCall} USDC/call via ${service.pricingModel}`);
  console.log('\nIt now appears in the marketplace (GET /services) and can be hired.');
}

main().catch((e) => {
  console.error('FAILED:', (e as Error).message);
  process.exit(1);
});
