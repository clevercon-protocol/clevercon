import express from 'express';
import corsMiddleware from 'cors';
import { logger as defaultLogger } from '@clevercon/common';
import type { Server } from 'node:http';
import { buildManifest, resolveConfig, type ResolvedConfig } from './config.js';
import { createRegistryClient, type RegistryClient } from './registry.js';
import { withX402 } from './payments/x402.js';
import { applyMppReceipt, withMpp, MPP_CHARGE_LOCAL } from './payments/mpp.js';
import type {
  AgentConfig,
  AgentResult,
  AgentServer,
  AgentTask,
  FeedbackOutcome,
  Logger,
  PaymentInfo,
  RegistrationPayload,
} from './types.js';

function isEnvelope(value: AgentResult): value is { result: unknown; status?: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'result' in value &&
    Object.keys(value as object).every((k) => k === 'result' || k === 'status')
  );
}

function resolveSelfUrl(resolved: ResolvedConfig, port: number): string {
  return resolved.selfUrl ?? `http://localhost:${port}`;
}

/** Wire an HTTP agent — manifest, health, and one paid task endpoint — from a
 *  small config. Fails fast (throws `AgentConfigError`) on invalid config. */
export function createAgent(config: AgentConfig): AgentServer {
  const resolved = resolveConfig(config);
  const log: Logger = config.logger ?? defaultLogger;
  const deps = config.deps ?? {};

  let boundPort = resolved.port;
  let selfUrl = resolveSelfUrl(resolved, boundPort);
  let manifest: RegistrationPayload = buildManifest(resolved, selfUrl);

  const app = express();
  if (resolved.cors) app.use(corsMiddleware());
  app.use(express.json());

  // ── Unpaid endpoints ────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      agent: resolved.name,
      address: resolved.publicKey,
      payment: resolved.payment === 'mpp' ? 'MPP' : 'x402',
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      agent: resolved.name,
      description: resolved.description,
      capabilities: resolved.capabilities,
      pricing: {
        model: resolved.payment,
        price_per_call: resolved.price,
        currency: resolved.currency,
      },
      stellar_address: resolved.publicKey,
    });
  });

  if (config.routes) config.routes(app);

  // ── Payment middleware ──────────────────────────────────────────
  const paymentMw =
    config.middleware ??
    (resolved.payment === 'x402'
      ? withX402(
          {
            path: resolved.taskPath,
            price: resolved.price,
            payTo: resolved.publicKey,
            network: resolved.network,
            facilitatorUrl: resolved.facilitatorUrl,
            description: `${resolved.name} paid task`,
            syncFacilitatorOnStart: resolved.syncFacilitatorOnStart,
          },
          deps,
        )
      : withMpp(
          {
            path: resolved.taskPath,
            price: resolved.price,
            payTo: resolved.publicKey,
            secretKey: resolved.secretKey,
            network: resolved.network,
            rpcUrl: resolved.rpcUrl,
            realm: resolved.realm,
            description: `${resolved.name} paid task`,
          },
          deps,
        ));
  app.use(paymentMw);

  // ── Paid task endpoint ─────────────────────────────────────────
  app.post(resolved.taskPath, async (req, res) => {
    const body: Record<string, unknown> =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const task: AgentTask = {
      body,
      query: String(body.query ?? body.instruction ?? ''),
      context: String(body.context ?? ''),
      req,
    };
    const payment: PaymentInfo = {
      model: resolved.payment,
      tx_hash: null,
      raw: res.locals[MPP_CHARGE_LOCAL] ? 'mpp' : null,
    };

    try {
      const out = await config.handler(task, {
        wallet: { publicKey: resolved.publicKey },
        payment,
        logger: log,
      });

      const status = isEnvelope(out) ? (out.status ?? 200) : 200;
      const result = isEnvelope(out) ? out.result : out;
      const payload = {
        result,
        agent: resolved.name,
        timestamp: new Date().toISOString(),
      };

      if (resolved.payment === 'mpp') {
        applyMppReceipt(res, JSON.stringify(payload));
      }
      res.status(status).json(payload);
    } catch (err) {
      const e = err as Error & { status?: number };
      log.error(`[${resolved.name}] handler error: ${e.message}`);
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  // ── Registry client ────────────────────────────────────────────
  let registry: RegistryClient = createRegistryClient({
    registryUrl: resolved.registryUrl,
    manifest,
    requesterAddress: resolved.publicKey,
    logger: log,
    fetchImpl: deps.fetch,
    heartbeatMs: resolved.heartbeatMs,
    label: resolved.name,
  });

  let shutdownHooked = false;
  function hookShutdown(server: Server): void {
    if (shutdownHooked || !resolved.gracefulShutdown) return;
    shutdownHooked = true;
    const onSignal = (signal: string) => {
      log.info(`[${resolved.name}] ${signal} received, deregistering`);
      void registry.deregister().finally(() => {
        server.close(() => process.exit(0));
      });
    };
    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  const server: AgentServer = {
    app,
    address: resolved.publicKey,
    get manifest() {
      return manifest;
    },
    registerSelf: () => registry.registerSelf(),
    deregister: () => registry.deregister(),
    reportFeedback: (jobId: string, outcome: FeedbackOutcome) =>
      registry.reportFeedback(jobId, outcome),
    stop: () => registry.stop(),
    listen(port?: number): Server {
      if (port !== undefined && port !== boundPort) {
        boundPort = port;
        if (!resolved.selfUrl && !process.env.SELF_URL) {
          selfUrl = `http://localhost:${boundPort}`;
          manifest = buildManifest(resolved, selfUrl);
          registry.stop();
          registry = createRegistryClient({
            registryUrl: resolved.registryUrl,
            manifest,
            requesterAddress: resolved.publicKey,
            logger: log,
            fetchImpl: deps.fetch,
            heartbeatMs: resolved.heartbeatMs,
            label: resolved.name,
          });
        }
      }
      const httpServer = app.listen(boundPort, () => {
        log.info(
          `[${resolved.name}] listening on ${boundPort} | wallet ${resolved.publicKey} | ${resolved.payment}`,
        );
        void registry.registerSelf();
      });
      hookShutdown(httpServer);
      return httpServer;
    },
  };

  return server;
}
