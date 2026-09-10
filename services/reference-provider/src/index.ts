import { createServer } from 'node:http';

/**
 * Reference provider: the minimal thing that makes a service on the CleverCon
 * marketplace real. It implements the provider fulfillment contract the worker
 * calls, so a buyer's hire actually runs against a live endpoint (and, when the
 * task is on-chain-locked, the provider gets paid on settlement).
 *
 * Fulfillment contract (services/workers executor -> provider):
 *   POST <endpoint>
 *     request  : { "action": string, "taskId": string }   (application/json)
 *     response : 2xx with a body (<= 2000 chars) = the step output
 *     non-2xx or timeout (15s) = the step fails
 *
 * Also exposes GET /health for liveness. This provider does trivial work (it
 * echoes the requested action with a timestamp); a real provider would do the
 * actual job here (a data lookup, an LLM call, etc.). The rail mechanics are
 * identical regardless of what the work is.
 */
const PORT = Number(process.env.PROVIDER_PORT ?? 4200);
const NAME = process.env.PROVIDER_NAME ?? 'reference-provider';

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', provider: NAME }));
    return;
  }
  if (req.method === 'POST') {
    let action = 'unknown';
    let taskId = 'unknown';
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      action = typeof body.action === 'string' ? body.action : action;
      taskId = typeof body.taskId === 'string' ? body.taskId : taskId;
    } catch {
      // tolerate a missing/invalid body; still fulfill
    }
    // The real work would happen here. We return a deterministic result so the
    // buyer sees a concrete output for the step.
    const result = {
      provider: NAME,
      action,
      taskId,
      result: `Fulfilled "${action}"`,
      at: new Date().toISOString(),
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`[reference-provider] "${NAME}" listening on :${PORT} (POST / to fulfill)`);
});
