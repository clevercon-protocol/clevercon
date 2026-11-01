/**
 * Reference provider services, one per interaction archetype, built on the
 * CleverCon provider SDK (`@clevercon/agent-sdk/provider`). These are runnable
 * templates a provider copies to list a real service of each shape; together they
 * exercise the full interaction model end to end (sync + trustless verification,
 * async polling, and needs-input elicitation).
 *
 * Run one at a time (each opens an HTTP server on its own port):
 *   SERVICE=notary  npx tsx examples/reference-services/providers.ts   # :4210
 *   SERVICE=async   npx tsx examples/reference-services/providers.ts   # :4211
 *   SERVICE=elicit  npx tsx examples/reference-services/providers.ts   # :4212
 *
 * Then register the running endpoint on CleverCon (dapp Provider console or the
 * API), picking the tier/payment/interaction shown in each `manifestHint` below,
 * and buyers can hire it. Delivery, acceptance, and payout are handled by the
 * platform; your only job is the `fulfill` function.
 */
import { fileURLToPath } from 'node:url';
import { createProvider, sha256Hex, type FulfillmentRequest } from '@clevercon/agent-sdk/provider';

// ── 1. Notary (sync, T1 trustlessly verifiable) ─────────────────────────────
// Returns the SHA-256 of the buyer's `data`. Register it tier T1 with
// verification { method: 'witness', spec: { predicate: 'sha256' } }: the worker
// re-hashes `data` and compares, so you are paid only on a correct hash and the
// buyer never has to trust you. Input schema: { data: string }.
const notaryManifestHint = {
  tier: 'T1',
  interaction: 'sync',
  paymentModel: 'escrow',
  verification: { method: 'witness', spec: { predicate: 'sha256' } },
  inputSchema: { type: 'object', required: ['data'], properties: { data: { type: 'string' } } },
};
function notary() {
  return createProvider({
    name: 'reference-notary',
    port: 4210,
    fulfill: (req: FulfillmentRequest) => {
      const data = typeof req.input.data === 'string' ? req.input.data : '';
      if (!data) return { status: 'failed' as const, error: 'input.data (string) is required' };
      // A bare object is treated as a completed sync delivery.
      return { sha256: sha256Hex(data) };
    },
  });
}

// ── 2. Long-running (async: the worker polls until done) ─────────────────────
// A dispatch starts a job and returns a durable handle with status 'working';
// the worker then polls that handle (kind: 'poll') until the job completes. Here
// the "work" finishes after a couple of polls; a real service would check its own
// job store / queue. Register it interaction 'async'.
const asyncJobs = new Map<string, { ticks: number }>();
function longRunning() {
  return createProvider({
    name: 'reference-async',
    port: 4211,
    fulfill: (req: FulfillmentRequest) => {
      if (req.kind === 'poll' && req.handle) {
        const job = asyncJobs.get(req.handle);
        if (!job) return { status: 'failed' as const, error: 'unknown job handle' };
        job.ticks += 1;
        if (job.ticks >= 2) {
          asyncJobs.delete(req.handle);
          return { status: 'completed' as const, data: { done: true, input: req.input } };
        }
        return {
          status: 'working' as const,
          handle: req.handle,
          progress: { pct: job.ticks * 40, message: `processing (${job.ticks}/2)` },
        };
      }
      // dispatch: register the job and hand back a handle to poll.
      const handle = `job-${req.jobId}`;
      asyncJobs.set(handle, { ticks: 0 });
      return { status: 'working' as const, handle, progress: { pct: 0, message: 'queued' } };
    },
  });
}

// ── 3. Needs-input (elicitation: ask the buyer mid-job) ──────────────────────
// A dispatch asks the buyer a question (status 'input_required'); the platform
// surfaces it, the buyer answers, and the worker resumes with kind: 'answer' and
// the response, which this handler uses to complete. Register it interaction
// 'human' (or 'async' if the question is optional).
function needsInput() {
  return createProvider({
    name: 'reference-elicit',
    port: 4212,
    fulfill: (req: FulfillmentRequest) => {
      if (req.kind === 'answer' && req.inputResponse) {
        const format = String(req.inputResponse.format ?? 'json');
        const text = `Delivered as ${format}: ${JSON.stringify(req.input)}`;
        return format === 'text' ? text : { status: 'completed' as const, data: { format, input: req.input } };
      }
      return {
        status: 'input_required' as const,
        inputRequest: {
          requestId: 'format',
          prompt: 'Which output format would you like? (json or text)',
          schema: { type: 'object', required: ['format'], properties: { format: { type: 'string' } } },
        },
      };
    },
  });
}

const SERVICES: Record<string, () => ReturnType<typeof createProvider>> = {
  notary,
  async: longRunning,
  elicit: needsInput,
};

export { notary, longRunning, needsInput, notaryManifestHint };

// Start the chosen service only when run directly (importing this module is safe).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const which = process.env.SERVICE ?? 'notary';
  const make = SERVICES[which];
  if (!make) {
    console.error(`Unknown SERVICE "${which}". Use one of: ${Object.keys(SERVICES).join(', ')}`);
    process.exit(1);
  }
  make().listen();
}
