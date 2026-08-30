import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { withX402, createPayingFetch } from './x402.js';
import type { SdkDeps } from '../types.js';

function fakeX402Deps(overrides: Partial<SdkDeps> = {}): {
  deps: SdkDeps;
  captured: { routes?: any; network?: string; sync?: unknown };
} {
  const captured: { routes?: any; network?: string; sync?: unknown } = {};
  const deps: SdkDeps = {
    HTTPFacilitatorClient: class {
      constructor(public opts: unknown) {}
    },
    ExactStellarSchemeServer: class {},
    x402ResourceServer: class {
      register(network: string) {
        captured.network = network;
        return this;
      }
    },
    paymentMiddleware: (
      routes: any,
      _server: unknown,
      _pc: unknown,
      _pw: unknown,
      sync: unknown,
    ) => {
      captured.routes = routes;
      captured.sync = sync;
      // Simulate the paywall: every request to a configured route is unpaid.
      return (_req: express.Request, res: express.Response) =>
        res.status(402).json({ error: 'x402' });
    },
    ...overrides,
  };
  return { deps, captured };
}

describe('withX402', () => {
  it('builds the route map with price, payTo and network', () => {
    const { deps, captured } = fakeX402Deps();
    withX402(
      {
        path: '/query',
        price: 0.02,
        payTo: 'GRECIPIENT',
        network: 'stellar:testnet',
        facilitatorUrl: 'http://facilitator',
        description: 'test task',
        syncFacilitatorOnStart: false,
      },
      deps,
    );
    expect(captured.network).toBe('stellar:testnet');
    expect(captured.sync).toBe(false);
    expect(captured.routes).toEqual({
      'POST /query': {
        accepts: {
          scheme: 'exact',
          price: '$0.02',
          network: 'stellar:testnet',
          payTo: 'GRECIPIENT',
        },
        description: 'test task',
      },
    });
  });

  it('returns a middleware that paywalls an unpaid request (402, handler never runs)', async () => {
    const { deps } = fakeX402Deps();
    const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));
    const app = express();
    app.use(express.json());
    app.use(
      withX402(
        {
          path: '/query',
          price: 0.02,
          payTo: 'GRECIPIENT',
          network: 'stellar:testnet',
          facilitatorUrl: 'http://facilitator',
        },
        deps,
      ),
    );
    app.post('/query', handler);

    const res = await request(app).post('/query').send({ query: 'hi' });
    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('createPayingFetch', () => {
  it('wraps fetch with the configured network and a fresh signer per call', async () => {
    const signers: string[] = [];
    const wrapped = vi.fn(async () => new Response('{}', { status: 200 }));
    const deps: SdkDeps = {
      createEd25519Signer: (secret: string) => {
        signers.push(secret);
        return { secret };
      },
      ExactStellarSchemeClient: class {
        constructor(public signer: unknown) {}
      },
      wrapFetchWithPaymentFromConfig: (_fetch: unknown, config: any) => {
        expect(config.schemes[0].network).toBe('stellar:testnet');
        return wrapped;
      },
    };

    const payingFetch = createPayingFetch(
      { secretKey: 'SSECRET', network: 'stellar:testnet' },
      deps,
    );
    await payingFetch('http://x');
    await payingFetch('http://y');

    expect(wrapped).toHaveBeenCalledTimes(2);
    expect(signers).toEqual(['SSECRET', 'SSECRET']); // rebuilt each call
  });
});
