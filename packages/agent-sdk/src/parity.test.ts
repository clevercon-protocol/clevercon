/**
 * Parity check: the SDK-built example agent (`examples/stellar-oracle`) must
 * serve the same HTTP surface and send the same registration manifest as the
 * hand-written `packages/agents/stellar-oracle`.
 *
 * The x402 facilitator is stubbed so the paywall resolves offline.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import type { Express } from 'express';

const SECRET = Keypair.random().secret();
const ADDRESS = Keypair.fromSecret(SECRET).publicKey();

const ORACLE_CAPABILITIES = [
  'blockchain-data',
  'crypto-prices',
  'stellar-dex',
  'orderbook',
  'network-stats',
  'market-data',
];
const ORACLE_DESCRIPTION =
  'Reads live Stellar blockchain data via Horizon API — DEX trades, orderbooks, account balances, network stats, and cross-exchange crypto prices.';

let app: Express;
let registerCalls: Record<string, unknown>[] = [];
let mod: typeof import('../examples/stellar-oracle/agent.js');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.EXAMPLE_ORACLE_SECRET_KEY = SECRET;
  process.env.X402_FACILITATOR_URL = 'http://facilitator.test';
  process.env.REGISTRY_URL = 'http://registry.test';
  delete process.env.EXAMPLE_ORACLE_PORT;
  delete process.env.PORT;
  delete process.env.SELF_URL;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet', extra: {} }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === 'http://registry.test/register') {
        registerCalls.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input as never, init);
    }),
  );

  mod = await import('../examples/stellar-oracle/agent.js');
  app = mod.agent.app;
});

afterAll(() => {
  mod.agent.stop();
  vi.unstubAllGlobals();
});

describe('stellar-oracle example — parity with packages/agents/stellar-oracle', () => {
  it('GET /health matches the health contract', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', agent: 'StellarOracle', address: ADDRESS });
  });

  it('GET / returns the manifest shape', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      agent: 'StellarOracle',
      description: ORACLE_DESCRIPTION,
      capabilities: ORACLE_CAPABILITIES,
      pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
      stellar_address: ADDRESS,
    });
  });

  it('GET /cache/stats is served (extra route via the SDK escape hatch)', async () => {
    const res = await request(app).get('/cache/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
  });

  it('POST /query is paywalled with x402 (402 when unpaid, handler never runs)', async () => {
    const res = await request(app).post('/query').send({ query: 'xlm price' });
    expect(res.status).toBe(402);
    expect(res.body.result).toBeUndefined();
  });

  it('registers the same manifest that stellar-oracle/src/register.ts builds', async () => {
    registerCalls = [];
    await mod.agent.registerSelf();
    expect(registerCalls).toHaveLength(1);
    // Mirror of packages/agents/stellar-oracle/src/register.ts.
    expect(registerCalls[0]).toEqual({
      agent_id: 'stellar-oracle',
      name: 'StellarOracle',
      description: ORACLE_DESCRIPTION,
      capabilities: ORACLE_CAPABILITIES,
      pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
      endpoint: 'http://localhost:4001/query',
      stellar_address: ADDRESS,
      health_check: 'http://localhost:4001/health',
    });
    expect(mod.agent.manifest).toEqual(registerCalls[0]);
  });
});
