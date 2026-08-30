import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { withMpp, applyMppReceipt, MPP_CHARGE_LOCAL } from './mpp.js';
import type { SdkDeps } from '../types.js';

const opts = {
  path: '/task',
  price: 0.005,
  payTo: 'GRECIPIENT',
  secretKey: 'SSECRET',
  network: 'stellar:testnet',
  rpcUrl: 'http://rpc',
  realm: 'clevercon-test',
};

function appWith(deps: SdkDeps, handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use(withMpp(opts, deps));
  app.post('/task', handler);
  return app;
}

describe('withMpp', () => {
  it('returns the 402 challenge and performs no work when unpaid', async () => {
    const charge = vi.fn(() => () => async () => ({
      status: 402 as const,
      challenge: {
        headers: new Headers({ 'www-authenticate': 'MPP realm="x"' }),
        json: async () => ({ error: 'payment required', realm: 'x' }),
      },
    }));
    const deps: SdkDeps = { createMppCharge: charge };
    const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));

    const res = await request(appWith(deps, handler)).post('/task').send({ instruction: 'go' });

    expect(res.status).toBe(402);
    expect(res.body).toEqual({ error: 'payment required', realm: 'x' });
    expect(res.headers['www-authenticate']).toBe('MPP realm="x"');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes through on payment and lets the finalizer attach the receipt', async () => {
    // Real `withReceipt` returns the passed-in Response with a receipt header
    // added; the response the SDK hands it already carries application/json.
    const withReceipt = vi.fn((response: Response) => {
      response.headers.set('x-payment-receipt', 'receipt-xyz');
      return response;
    });
    const charge = vi.fn(() => () => async () => ({ status: 200 as const, withReceipt }));
    const deps: SdkDeps = { createMppCharge: charge };

    const handler = vi.fn((_req: express.Request, res: express.Response) => {
      expect(res.locals[MPP_CHARGE_LOCAL]).toBeDefined();
      const payload = { result: 'done', agent: 'X', timestamp: 't' };
      applyMppReceipt(res, JSON.stringify(payload));
      res.json(payload);
    });

    const res = await request(appWith(deps, handler)).post('/task').send({ instruction: 'go' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'done', agent: 'X', timestamp: 't' });
    expect(res.headers['x-payment-receipt']).toBe('receipt-xyz');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(withReceipt).toHaveBeenCalledTimes(1);
  });

  it('surfaces charge errors to the express error path (no work performed)', async () => {
    const charge = vi.fn(() => () => async () => {
      throw new Error('soroban down');
    });
    const deps: SdkDeps = { createMppCharge: charge };
    const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));

    const res = await request(appWith(deps, handler)).post('/task').send({});
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
