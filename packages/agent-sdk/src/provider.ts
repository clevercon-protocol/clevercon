import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

/**
 * The CleverCon provider fulfillment SDK: the small amount of glue that turns a
 * function into a service the marketplace can hire. When a buyer hires your
 * service, the CleverCon worker POSTs each plan step to your endpoint and your
 * handler's return value becomes the step output the buyer sees (and, when the
 * task is locked on-chain, what the vault pays you for on settlement).
 *
 * This is deliberately dependency-free (node:http only) so a provider is a
 * single file with no framework. Import it from the lightweight subpath so you
 * do not pull in the x402/mpp agent runtime:
 *
 *     import { createProvider } from '@clevercon/agent-sdk/provider';
 *
 * Fulfillment contract (must match services/workers executor):
 *   POST <endpoint>
 *     request  : { "action": string, "taskId": string }   (application/json)
 *     response : 2xx with a body = the step output (the worker truncates to
 *                MAX_OUTPUT_CHARS, so keep results concise)
 *     non-2xx or a timeout (the worker aborts at 15s) = the step fails
 *   GET <endpoint>/health -> 200 { status: 'ok', provider }
 */

/** The worker truncates step output to this many characters; longer is wasted. */
export const MAX_OUTPUT_CHARS = 2000;

export interface FulfillmentRequest {
  /** The plan step action the buyer asked this provider to perform. */
  action: string;
  /** The CleverCon task id this step belongs to (useful for logging/idempotency). */
  taskId: string;
  /** The full parsed JSON body the worker sent (action/taskId plus any extras). */
  body: Record<string, unknown>;
}

/**
 * What a handler returns for a step. A string is sent verbatim; anything else is
 * JSON-encoded. Either way the worker reads it as text, so both are valid.
 */
export type FulfillmentResult = string | number | boolean | object;

export type FulfillmentHandler = (
  req: FulfillmentRequest,
) => FulfillmentResult | Promise<FulfillmentResult>;

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export interface ProviderOptions {
  /** Does the actual work and returns the step output. Throw to fail the step. */
  fulfill: FulfillmentHandler;
  /** Provider name, surfaced on /health and in logs. */
  name?: string;
  /** Default port for listen() when none is passed (defaults to 4200). */
  port?: number;
  /** Where to log lifecycle lines (defaults to console). */
  logger?: Logger;
}

export interface Provider {
  readonly name: string;
  /**
   * The bare request handler, so you can embed the provider in an existing
   * server or test it without opening a socket.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Start an http server. Returns it so callers can close() on shutdown. */
  listen(port?: number): Server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function encodeResult(result: FulfillmentResult): { contentType: string; body: string } {
  if (typeof result === 'string') return { contentType: 'text/plain; charset=utf-8', body: result };
  return { contentType: 'application/json', body: JSON.stringify(result) };
}

/**
 * Wire a CleverCon provider from a single fulfillment function. Handles the
 * health check, body parsing, JSON/text encoding, and error-to-500 mapping so
 * the only thing you write is the work itself.
 */
export function createProvider(options: ProviderOptions): Provider {
  const name = options.name ?? 'clevercon-provider';
  const log: Logger = options.logger ?? console;
  const defaultPort = options.port ?? 4200;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', provider: name }));
      return;
    }

    if (req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        const raw = (await readBody(req)) || '{}';
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
      } catch {
        // Tolerate a missing/invalid body; the handler still runs with defaults.
      }
      const action = typeof body.action === 'string' ? body.action : 'unknown';
      const taskId = typeof body.taskId === 'string' ? body.taskId : 'unknown';

      try {
        const result = await options.fulfill({ action, taskId, body });
        const { contentType, body: out } = encodeResult(result);
        if (out.length > MAX_OUTPUT_CHARS) {
          log.info(
            `[${name}] output for "${action}" is ${out.length} chars; the worker will truncate to ${MAX_OUTPUT_CHARS}`,
          );
        }
        res.writeHead(200, { 'content-type': contentType });
        res.end(out);
      } catch (err) {
        // A thrown handler is a failed step: return non-2xx so the worker marks
        // it FAILED and does not pay for it.
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[${name}] fulfill error for "${action}" (task ${taskId}): ${message}`);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  return {
    name,
    handle,
    listen(port = defaultPort): Server {
      const server = createServer((req, res) => {
        void handle(req, res);
      });
      server.listen(port, () => {
        log.info(`[${name}] listening on :${port} (POST / to fulfill, GET /health for liveness)`);
      });
      return server;
    },
  };
}
