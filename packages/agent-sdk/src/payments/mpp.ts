import { Mppx } from 'mppx/server';
import { stellar } from '@stellar/mpp/charge/server';
import { USDC_SAC_TESTNET } from '@stellar/mpp';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SdkDeps } from '../types.js';

export interface WithMppOptions {
  /** Route to protect, e.g. `/analyze`. */
  path: string;
  /** USDC per call. */
  price: number;
  /** Stellar address that receives payment. */
  payTo: string;
  /** Signing key for challenge binding (the agent's own key). */
  secretKey: string;
  network: string;
  rpcUrl: string;
  realm: string;
  /** SAC address of the charged asset. Default: testnet USDC. */
  asset?: string;
  description?: string;
}

/** Where the paid MPP charge result is stashed for the response finalizer. */
export const MPP_CHARGE_LOCAL = 'mppCharge';

interface MppChargeResult {
  status: 200 | 402;
  challenge?: { headers: Headers; json: () => Promise<unknown> };
  withReceipt?: (response: Response | globalThis.Response) => unknown;
}

/** Build the MPP payment middleware for a single paid route.
 *  Distilled from `packages/agents/analysis/src/server.ts` — the Mppx handler is
 *  created lazily so a Soroban RPC hiccup at startup does not kill the process,
 *  and on `402` the challenge is written and no work is performed. */
export function withMpp(opts: WithMppOptions, deps: SdkDeps = {}): RequestHandler {
  const asset = opts.asset ?? USDC_SAC_TESTNET;
  const amount = String(opts.price);

  const makeCharge =
    (deps.createMppCharge as
      | (() => (
          o: Record<string, unknown>,
        ) => (req: globalThis.Request) => Promise<MppChargeResult>)
      | undefined) ??
    (() => {
      const mppx = Mppx.create({
        methods: [
          stellar({
            recipient: opts.payTo,
            currency: asset,
            network: opts.network as any,
            rpcUrl: opts.rpcUrl,
          }),
        ],
        secretKey: opts.secretKey,
        realm: opts.realm,
      });
      return (mppx as any)['stellar/charge'];
    });

  let chargeFn: ReturnType<typeof makeCharge> | null = null;
  const getChargeFn = () => {
    if (!chargeFn) chargeFn = makeCharge();
    return chargeFn;
  };

  return async function mppMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const fetchReq = expressToFetchRequest(req);
      const result = (await getChargeFn()({
        amount,
        currency: asset,
        recipient: opts.payTo,
        description: opts.description ?? 'Paid agent task - CleverCon',
      })(fetchReq)) as MppChargeResult;

      if (result.status === 402) {
        res.status(402);
        result.challenge?.headers.forEach((value, key) => res.setHeader(key, value));
        res.json(result.challenge ? await result.challenge.json() : { error: 'payment required' });
        return;
      }

      res.locals[MPP_CHARGE_LOCAL] = result;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Build a Fetch API `Request` from an Express request — the MPP SDK verifies
 *  against a WHATWG request. Mirrors `analysis/src/server.ts`. */
export function expressToFetchRequest(req: Request): globalThis.Request {
  const protocol = req.protocol || 'http';
  const host = req.headers.host || 'localhost';
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
  );
  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  });
}

/** Attach the MPP receipt headers from a paid charge result onto the Express
 *  response. Returns true when a receipt was applied. */
export function applyMppReceipt(res: Response, body: string): boolean {
  const result = res.locals[MPP_CHARGE_LOCAL] as MppChargeResult | undefined;
  if (!result?.withReceipt) return false;
  try {
    const receipt = result.withReceipt(
      new Response(body, { headers: { 'Content-Type': 'application/json' } }) as any,
    );
    const finalResponse = (receipt as any)?.response ?? receipt;
    if (finalResponse?.headers?.forEach) {
      finalResponse.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    }
    return true;
  } catch {
    return false;
  }
}
