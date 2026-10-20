import { createHash } from 'node:crypto';
import { Horizon, Asset } from '@stellar/stellar-sdk';
import type { JobResultEnvelope } from '@clevercon/agent-sdk';

/**
 * The reference provider's catalog: real, hireable services on one process. Each
 * declares the acceptance contract the CleverCon worker enforces, so a buyer is
 * paid-for only on a result that passes the declared check. One endpoint serves
 * all of them; the worker dispatches by `action` (= the service's capability).
 */
const IS_MAINNET = process.env.NETWORK === 'mainnet' || process.env.NETWORK === 'public';
const HORIZON_URL =
  process.env.HORIZON_URL ??
  (IS_MAINNET ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
const USDC_ISSUER =
  process.env.USDC_ISSUER ??
  (IS_MAINNET
    ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

const server = new Horizon.Server(HORIZON_URL);
const USDC = new Asset('USDC', USDC_ISSUER);

function envelope(data: unknown): JobResultEnvelope {
  return { ok: true, contentType: 'application/json', data, issuedAt: Math.floor(Date.now() / 1000) };
}

export interface ServiceDef {
  /** The capability/action the worker sends; the step's action must match. */
  action: string;
  name: string;
  description: string;
  category: string;
  pricePerCall: number;
  tier: 'T1' | 'T2';
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  verification?: { method: string; spec?: Record<string, unknown> };
  handler: (input: Record<string, unknown>) => Promise<JobResultEnvelope>;
}

// ── 1. Stellar account intelligence (T1, onchain-verifiable) ──────────────────
async function accountBalances(input: Record<string, unknown>): Promise<JobResultEnvelope> {
  const address = String(input.address ?? '');
  const acct = await server.loadAccount(address);
  const balances = acct.balances.map((b) => ({
    asset:
      b.asset_type === 'native'
        ? 'XLM'
        : b.asset_type === 'liquidity_pool_shares'
          ? `pool:${b.liquidity_pool_id}`
          : `${b.asset_code}:${b.asset_issuer}`,
    balance: b.balance,
  }));
  return envelope({ address, balances, at: new Date().toISOString() });
}

// ── 2. Data notary (T1, witness-verifiable: the worker re-hashes) ─────────────
function dataHash(input: Record<string, unknown>): Promise<JobResultEnvelope> {
  const data = String(input.data ?? '');
  const sha256 = createHash('sha256').update(data).digest('hex');
  return Promise.resolve(envelope({ sha256, algo: 'sha256', bytes: data.length, at: new Date().toISOString() }));
}

// ── 3. Stellar market snapshot (T2, attestable) ───────────────────────────────
async function marketSnapshot(): Promise<JobResultEnvelope> {
  const [ledgerRes, trades] = await Promise.all([
    server.ledgers().limit(1).order('desc').call(),
    server.trades().forAssetPair(Asset.native(), USDC).limit(1).order('desc').call().catch(() => null),
  ]);
  const latest = ledgerRes.records[0];
  const t = trades?.records?.[0];
  const price = t?.price?.n && t?.price?.d ? (Number(t.price.n) / Number(t.price.d)).toFixed(6) : null;
  return envelope({
    network: {
      latest_ledger: latest.sequence,
      base_fee_stroops: latest.base_fee_in_stroops,
      closed_at: latest.closed_at,
    },
    market: { pair: 'XLM/USDC', price, at: t?.ledger_close_time ?? null },
    at: new Date().toISOString(),
  });
}

export const SERVICES: ServiceDef[] = [
  {
    action: 'account.balances',
    name: 'Stellar Account Intelligence',
    description: 'Balances and trustlines for any Stellar account, straight from the ledger.',
    category: 'Data & Oracles',
    pricePerCall: 0.02,
    tier: 'T1',
    inputSchema: {
      type: 'object',
      required: ['address'],
      properties: {
        address: {
          type: 'string',
          description: 'A Stellar account (G…) to report its balances and trustlines for',
        },
      },
    },
    outputSchema: { type: 'object', required: ['balances'], properties: { balances: { type: 'array' } } },
    verification: {
      method: 'onchain',
      spec: { source: 'horizon', derive: 'accounts/{address}/balances', match: 'balances' },
    },
    handler: accountBalances,
  },
  {
    action: 'data.hash',
    name: 'Data Notary',
    description: 'A sha256 commitment of your data, re-checkable by anyone (trustless).',
    category: 'Compute & Proofs',
    pricePerCall: 0.01,
    tier: 'T1',
    inputSchema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { type: 'string', description: 'Any text to hash and notarize (sha256)' },
      },
    },
    outputSchema: { type: 'object', required: ['sha256'], properties: { sha256: { type: 'string' } } },
    verification: { method: 'witness', spec: { predicate: 'sha256' } },
    handler: dataHash,
  },
  {
    action: 'market.snapshot',
    name: 'Stellar Market Oracle',
    description: 'Latest ledger stats and a best-effort XLM/USDC spot price.',
    category: 'Data & Oracles',
    pricePerCall: 0.03,
    tier: 'T2',
    outputSchema: { type: 'object', required: ['network'], properties: { network: { type: 'object' } } },
    verification: { method: 'attest' },
    handler: () => marketSnapshot(),
  },
];

export const SERVICE_BY_ACTION = new Map(SERVICES.map((s) => [s.action, s]));
