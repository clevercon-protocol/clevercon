import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type {
  ServiceManifest,
  ArtifactRef,
  InputRequest,
  JobResultEnvelope,
  ResultStatus,
} from './marketplace.js';

/**
 * The CleverCon provider fulfillment SDK: the small amount of glue that turns a
 * function into a service the marketplace can hire. When a buyer hires your
 * service, the CleverCon worker POSTs each plan step to your endpoint and your
 * handler decides the outcome: a completed result the buyer sees (and, when the
 * task is locked on-chain, what the vault pays you for on settlement), a
 * long-running job the worker polls, or a question to put back to the buyer.
 *
 * This is deliberately dependency-free (node:http + node:crypto) so a provider is
 * a single file with no framework. Import it from the lightweight subpath so you
 * do not pull in the x402/mpp agent runtime:
 *
 *     import { createProvider } from '@clevercon/agent-sdk/provider';
 *
 * Fulfillment contract (matches services/workers executor):
 *   POST <endpoint>
 *     request  : a JobRequestEnvelope (application/json). Key fields your handler
 *                gets: action, taskId, jobId, input, attachments, idempotencyKey,
 *                and for the async lifecycle: kind ('dispatch'|'poll'|'answer'),
 *                handle, requestId, inputResponse.
 *     response : your handler's return value. A bare value (string/number/object)
 *                is treated as a COMPLETED sync delivery (back-compat). Return a
 *                FulfillmentOutcome to drive the async lifecycle:
 *                  - { status:'completed', data, artifact? }
 *                  - { status:'working', handle, progress? }   (worker will poll)
 *                  - { status:'input_required', inputRequest }  (ask the buyer)
 *                  - { status:'failed', error }
 *     A thrown handler, non-2xx, or a timeout (the worker aborts at 15s) fails the
 *     step and the lock refunds.
 *   GET <endpoint>/health -> 200 { status:'ok', provider }
 */

/** The worker truncates completed step output to this many characters; longer is wasted. */
export const MAX_OUTPUT_CHARS = 2000;

export interface FulfillmentRequest {
  /** The plan step action the buyer asked this provider to perform (a capability). */
  action: string;
  /** The CleverCon task id this step belongs to. */
  taskId: string;
  /** The job id (per step); stable across poll/answer calls for the same step. */
  jobId: string;
  /** Structured job input (validated against the service's inputSchema). */
  input: Record<string, unknown>;
  /** Buyer-supplied input files, by reference (fetch + verify with fetchAttachment). */
  attachments: ArtifactRef[];
  /** A retried hire carries the same key; dedupe long/side-effecting work on it. */
  idempotencyKey: string;
  /**
   * What this call does: `dispatch` starts a job, `poll` checks an async handle,
   * `answer` resumes an input_required step. Absent/legacy requests are `dispatch`.
   */
  kind: 'dispatch' | 'poll' | 'answer';
  /** Your durable job handle, echoed back on a `poll` (the one you returned as working). */
  handle?: string;
  /** On an `answer`: the id of the InputRequest being answered. */
  requestId?: string;
  /** On an `answer`: the buyer's response payload. */
  inputResponse?: Record<string, unknown>;
  /** The full parsed JSON body the worker sent (everything above, plus any extras). */
  body: Record<string, unknown>;
}

/** An explicit completed delivery (optionally carrying a file artifact). */
export interface CompletedOutcome {
  status: 'completed';
  /** Inline result (string sent verbatim, anything else JSON-encoded). */
  data?: unknown;
  /** A delivered file, by reference (build with artifactRef). */
  artifact?: ArtifactRef;
  /** Override the content type (defaults by data type). */
  contentType?: string;
}

/** A long-running job: the worker will poll `handle` until it completes. */
export interface WorkingOutcome {
  status: 'working';
  /** Your durable handle to resume/check the job; echoed back on each poll. */
  handle: string;
  /** Optional progress for the buyer's UI. */
  progress?: { pct?: number; message?: string };
}

/** The job needs an answer from the buyer before it can continue. */
export interface InputRequiredOutcome {
  status: 'input_required';
  inputRequest: InputRequest;
  /** Optional handle so a subsequent answer is correlated to this job. */
  handle?: string;
}

/** The job failed; the step is marked FAILED and the lock refunds. */
export interface FailedOutcome {
  status: 'failed';
  error: string;
}

export type FulfillmentOutcome =
  | CompletedOutcome
  | WorkingOutcome
  | InputRequiredOutcome
  | FailedOutcome;

/**
 * What a handler returns for a step. A bare value is a completed sync delivery
 * (sent verbatim if a string, JSON-encoded otherwise). Return a FulfillmentOutcome
 * to drive the async lifecycle (working/input_required/completed/failed).
 */
export type FulfillmentResult = string | number | boolean | object;

export type FulfillmentHandler = (
  req: FulfillmentRequest,
) =>
  | FulfillmentResult
  | FulfillmentOutcome
  | Promise<FulfillmentResult | FulfillmentOutcome>;

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export interface ProviderOptions {
  /** Does the actual work and returns the step outcome. Throw to fail the step. */
  fulfill: FulfillmentHandler;
  /** Provider name, surfaced on /health and in logs. */
  name?: string;
  /** Default port for listen() when none is passed (defaults to 4200). */
  port?: number;
  /** Where to log lifecycle lines (defaults to console). */
  logger?: Logger;
  /**
   * The service's acceptance contract (tier, io schemas, verification spec). Used
   * by the marketplace to register the service and by buyers to verify delivery.
   * Optional for back-compat; required for the new acceptance pipeline.
   */
  manifest?: ServiceManifest;
  /**
   * Optional signer for completed deliveries: given the canonical payload
   * `jobId|sha256(input)|sha256(output)|issuedAt`, return a signature string. The
   * envelope carries it as `signature` so a buyer can verify provenance against
   * your declared key (verification.method 'signature'). You choose the signing
   * lib (e.g. a Stellar keypair), so the SDK stays dependency-free.
   */
  sign?: (payload: string) => string | Promise<string>;
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

const RESULT_STATUSES: ReadonlySet<string> = new Set<ResultStatus>([
  'completed',
  'working',
  'input_required',
  'failed',
]);

/** sha256 of bytes or a string, as lowercase hex. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data, 'utf-8') : data)
    .digest('hex');
}

/**
 * Build a content-addressed ArtifactRef for a file you have already uploaded to a
 * public URL (your bucket/CDN). The hash lets the buyer verify the bytes they
 * download are exactly what you delivered (content-hash integrity + T1 checks).
 */
export function artifactRef(url: string, bytes: Uint8Array, contentType: string): ArtifactRef {
  return { url, hash: `sha256:${sha256Hex(bytes)}`, contentType, size: bytes.byteLength };
}

/**
 * Fetch a buyer-supplied attachment and verify its bytes hash to the reference, so
 * a tampered or swapped file is rejected before you process it. Throws on a hash
 * mismatch or a non-2xx fetch. Returns the verified bytes + content type.
 */
export async function fetchAttachment(
  ref: ArtifactRef,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(ref.url);
  if (!res.ok) throw new Error(`attachment fetch failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const want = ref.hash.startsWith('sha256:') ? ref.hash.slice('sha256:'.length) : ref.hash;
  const got = sha256Hex(bytes);
  if (want.toLowerCase() !== got.toLowerCase())
    throw new Error('attachment hash mismatch (content does not match the reference)');
  return { bytes, contentType: ref.contentType };
}

function isOutcome(value: unknown): value is FulfillmentOutcome {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { status?: unknown }).status === 'string' &&
    RESULT_STATUSES.has((value as { status: string }).status)
  );
}

function encodePlain(result: FulfillmentResult): { contentType: string; body: string } {
  if (typeof result === 'string') return { contentType: 'text/plain; charset=utf-8', body: result };
  return { contentType: 'application/json', body: JSON.stringify(result) };
}

/** Turn an explicit outcome into the standard JobResultEnvelope the worker reads. */
async function encodeOutcome(
  outcome: FulfillmentOutcome,
  req: FulfillmentRequest,
  sign: ProviderOptions['sign'],
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  if (outcome.status === 'working') {
    const env: JobResultEnvelope = {
      ok: true,
      status: 'working',
      contentType: 'application/json',
      handle: outcome.handle,
      issuedAt,
      ...(outcome.progress ? { progress: outcome.progress } : {}),
    };
    return JSON.stringify(env);
  }
  if (outcome.status === 'input_required') {
    const env: JobResultEnvelope = {
      ok: true,
      status: 'input_required',
      contentType: 'application/json',
      inputRequest: outcome.inputRequest,
      issuedAt,
      ...(outcome.handle ? { handle: outcome.handle } : {}),
    };
    return JSON.stringify(env);
  }
  if (outcome.status === 'failed') {
    const env: JobResultEnvelope = {
      ok: false,
      status: 'failed',
      contentType: 'application/json',
      error: outcome.error,
      issuedAt,
    };
    return JSON.stringify(env);
  }
  // completed
  const data = outcome.data;
  const contentType =
    outcome.contentType ?? (typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json');
  const env: JobResultEnvelope = {
    ok: true,
    status: 'completed',
    contentType,
    issuedAt,
    ...(data !== undefined ? { data } : {}),
    ...(outcome.artifact ? { artifact: outcome.artifact } : {}),
  };
  if (sign) {
    const outputStr = typeof data === 'string' ? data : JSON.stringify(data ?? outcome.artifact ?? '');
    const payload = `${req.jobId}|${sha256Hex(JSON.stringify(req.input))}|${sha256Hex(outputStr)}|${issuedAt}`;
    env.signature = await sign(payload);
  }
  return JSON.stringify(env);
}

/** Pull the typed fields out of the worker's JSON body into a FulfillmentRequest. */
function parseRequest(body: Record<string, unknown>): FulfillmentRequest {
  const str = (v: unknown, dflt = ''): string => (typeof v === 'string' ? v : dflt);
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const kindRaw = str(body.kind, 'dispatch');
  const kind = kindRaw === 'poll' || kindRaw === 'answer' ? kindRaw : 'dispatch';
  return {
    action: str(body.action, 'unknown'),
    taskId: str(body.taskId, 'unknown'),
    jobId: str(body.jobId) || str(body.stepId) || 'unknown',
    input: obj(body.input),
    attachments: Array.isArray(body.attachments) ? (body.attachments as ArtifactRef[]) : [],
    idempotencyKey: str(body.idempotencyKey),
    kind,
    handle: typeof body.handle === 'string' ? body.handle : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    inputResponse: body.inputResponse ? obj(body.inputResponse) : undefined,
    body,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Wire a CleverCon provider from a single fulfillment function. Handles the
 * health check, body parsing, the sync/async/needs-input encoding, and
 * error-to-500 mapping so the only thing you write is the work itself.
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
      const request = parseRequest(body);

      try {
        const result = await options.fulfill(request);
        if (isOutcome(result)) {
          const out = await encodeOutcome(result, request, options.sign);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(out);
          return;
        }
        const { contentType, body: out } = encodePlain(result);
        if (out.length > MAX_OUTPUT_CHARS) {
          log.info(
            `[${name}] output for "${request.action}" is ${out.length} chars; the worker will truncate to ${MAX_OUTPUT_CHARS}`,
          );
        }
        res.writeHead(200, { 'content-type': contentType });
        res.end(out);
      } catch (err) {
        // A thrown handler is a failed step: return non-2xx so the worker marks
        // it FAILED and does not pay for it.
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[${name}] fulfill error for "${request.action}" (task ${request.taskId}): ${message}`);
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
