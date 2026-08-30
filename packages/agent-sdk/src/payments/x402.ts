import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme as ExactStellarSchemeServer } from '@x402/stellar/exact/server';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme as ExactStellarSchemeClient } from '@x402/stellar/exact/client';
import type { RequestHandler } from 'express';
import type { SdkDeps } from '../types.js';

export interface WithX402Options {
  /** Route to protect, e.g. `/query`. */
  path: string;
  /** USDC per call. */
  price: number;
  /** Stellar address that receives payment. */
  payTo: string;
  network: string;
  facilitatorUrl: string;
  description?: string;
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH';
  /** Sync the facilitator on startup (mirrors the existing agents). */
  syncFacilitatorOnStart?: boolean;
}

/** Build the x402 payment middleware for a single paid route.
 *  Distilled from `packages/agents/stellar-oracle/src/server.ts`. */
export function withX402(opts: WithX402Options, deps: SdkDeps = {}): RequestHandler {
  const Facilitator = (deps.HTTPFacilitatorClient ?? HTTPFacilitatorClient) as any;
  const ResourceServer = (deps.x402ResourceServer ?? x402ResourceServer) as any;
  const SchemeServer = (deps.ExactStellarSchemeServer ?? ExactStellarSchemeServer) as any;
  const buildMiddleware = (deps.paymentMiddleware ?? paymentMiddleware) as any;

  const facilitatorClient = new Facilitator({ url: opts.facilitatorUrl });
  const resourceServer = new ResourceServer(facilitatorClient).register(
    opts.network,
    new SchemeServer(),
  );

  const routeKey = `${opts.method ?? 'POST'} ${opts.path}`;
  const routes = {
    [routeKey]: {
      accepts: {
        scheme: 'exact',
        price: `$${opts.price}`,
        network: opts.network,
        payTo: opts.payTo,
      },
      description: opts.description ?? 'Paid agent task',
    },
  };

  return buildMiddleware(
    routes,
    resourceServer,
    undefined,
    undefined,
    opts.syncFacilitatorOnStart ?? true,
  ) as RequestHandler;
}

export interface PayingFetchOptions {
  secretKey: string;
  network?: string;
}

/** A `fetch` that transparently settles x402 `402` challenges using the given
 *  Stellar key. A fresh signer is built per call — `ExactStellarScheme` signs a
 *  transaction at call time, so a reused scheme can replay a stale sequence
 *  number (see `orchestrator/src/x402-client.ts`). For agents that pay
 *  downstream services. */
export function createPayingFetch(opts: PayingFetchOptions, deps: SdkDeps = {}): typeof fetch {
  const network = opts.network ?? process.env.STELLAR_NETWORK ?? 'stellar:testnet';
  const wrap = (deps.wrapFetchWithPaymentFromConfig ?? wrapFetchWithPaymentFromConfig) as any;
  const makeSigner = (deps.createEd25519Signer ?? createEd25519Signer) as any;
  const SchemeClient = (deps.ExactStellarSchemeClient ?? ExactStellarSchemeClient) as any;

  const payingFetch: typeof fetch = (input, init) => {
    const signer = makeSigner(opts.secretKey);
    const scheme = new SchemeClient(signer);
    const wrapped = wrap(fetch, { schemes: [{ network, client: scheme }] }) as typeof fetch;
    return wrapped(input as any, init);
  };
  return payingFetch;
}
