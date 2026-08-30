import type { Express, Request, RequestHandler } from 'express';
import type { Server } from 'node:http';

type LogFn = (msg: string, data?: unknown) => void;

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

export type PaymentModel = 'x402' | 'mpp';

/** What the registry stores and the SDK POSTs to `/register`. Mirrors
 *  `AgentManifest` in `@clevercon/common` — kept as a local alias so the SDK
 *  does not force a common import on consumers who only want the types. */
export interface RegistrationPayload {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: { model: PaymentModel; price_per_call: number; currency: 'USDC' };
  endpoint: string;
  stellar_address: string;
  health_check: string;
}

export interface AgentManifestConfig {
  agent_id: string;
  name: string;
  description: string;
}

/** Settlement information for the current paid request, handed to the handler. */
export interface PaymentInfo {
  model: PaymentModel;
  /** Present once payment is verified; `null` for unpaid/override flows. */
  tx_hash: string | null;
  /** Raw settlement/receipt header value, when the payment layer exposed one. */
  raw: string | null;
}

export interface AgentTask {
  /** Parsed JSON body of the request. */
  body: Record<string, unknown>;
  /** `body.query` or `body.instruction`, else `''`. */
  query: string;
  /** `body.context`, else `''`. */
  context: string;
  /** Escape hatch: the raw Express request. */
  req: Request;
}

export interface AgentContext {
  wallet: { publicKey: string };
  payment: PaymentInfo;
  logger: Logger;
}

/** A handler may return a bare value (wrapped as `{ result }`) or an envelope
 *  with an explicit HTTP status. */
export type AgentResult = unknown | { result: unknown; status?: number };

export type AgentHandler = (
  task: AgentTask,
  ctx: AgentContext,
) => AgentResult | Promise<AgentResult>;

export interface FeedbackOutcome {
  success: boolean;
  /** 1-5; defaults to 3 on success, 1 on failure (matches the orchestrator). */
  quality_rating?: number;
  latency_ms?: number;
}

/** Injection seam for tests — every field defaults to the real implementation. */
export interface SdkDeps {
  fetch?: typeof fetch;
  /** `@x402/express` `paymentMiddleware`. */
  paymentMiddleware?: unknown;
  /** `@x402/express` `x402ResourceServer` constructor. */
  x402ResourceServer?: unknown;
  /** `@x402/core/server` `HTTPFacilitatorClient` constructor. */
  HTTPFacilitatorClient?: unknown;
  /** `@x402/stellar/exact/server` `ExactStellarScheme` constructor. */
  ExactStellarSchemeServer?: unknown;
  /** `@x402/fetch` `wrapFetchWithPaymentFromConfig`. */
  wrapFetchWithPaymentFromConfig?: unknown;
  /** `@x402/stellar` `createEd25519Signer`. */
  createEd25519Signer?: unknown;
  /** `@x402/stellar/exact/client` `ExactStellarScheme` constructor. */
  ExactStellarSchemeClient?: unknown;
  /** Factory returning an object with a `stellar/charge` method (mppx). */
  createMppCharge?: unknown;
}

export interface AgentConfig {
  manifest: AgentManifestConfig;
  capabilities: string[];
  /** USDC per call. */
  price: number;
  payment: PaymentModel;
  handler: AgentHandler;
  wallet: { secretKey: string };

  registryUrl?: string;
  /** Publicly reachable base URL. Default `http://localhost:<port>`. */
  selfUrl?: string;
  /** Port to bind. Default `process.env.PORT` or `3000`; `listen(port)` overrides. */
  port?: number;
  /** Paid endpoint path, default `/query`. */
  taskPath?: string;
  currency?: 'USDC';
  network?: string;
  /** x402 facilitator URL. */
  facilitatorUrl?: string;
  /** MPP Soroban RPC URL. */
  rpcUrl?: string;
  /** MPP realm, default `clevercon-<agent_id>`. */
  realm?: string;

  cors?: boolean;
  /** Deregister on SIGTERM/SIGINT, default `true`. */
  gracefulShutdown?: boolean;
  /** x402 `syncFacilitatorOnStart`, default `true`. */
  syncFacilitatorOnStart?: boolean;
  /** Re-register heartbeat interval in ms, default 4 min. `0` disables it. */
  heartbeatMs?: number;

  /** Escape hatch: replace the built-in payment middleware entirely. */
  middleware?: RequestHandler | RequestHandler[];
  /** Register extra (unpaid) routes before `listen()`. */
  routes?: (app: Express) => void;

  logger?: Logger;
  deps?: SdkDeps;
}

export interface AgentServer {
  app: Express;
  /** Public key derived from `wallet.secretKey`. */
  address: string;
  /** The manifest that will be sent to the registry. */
  manifest: RegistrationPayload;
  registerSelf(): Promise<void>;
  deregister(): Promise<void>;
  reportFeedback(jobId: string, outcome: FeedbackOutcome): Promise<void>;
  listen(port?: number): Server;
  /** Stop timers (heartbeat / pending retries). */
  stop(): void;
}
