import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createProvider, MAX_OUTPUT_CHARS } from './provider.js';

/**
 * Drive the provider's bare handler without opening a socket. Feeds `body` in as
 * the request stream and captures what the handler writes back.
 */
async function invoke(
  provider: ReturnType<typeof createProvider>,
  method: string,
  url: string,
  body?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;

  let status = 0;
  let headers: Record<string, string> = {};
  let out = '';
  const res = {
    writeHead(code: number, h: Record<string, string>) {
      status = code;
      headers = h;
    },
    end(chunk?: string) {
      if (chunk) out += chunk;
    },
  } as unknown as ServerResponse;

  const done = provider.handle(req, res);
  // Emit the request body on the next tick, after handle() has attached listeners.
  await Promise.resolve();
  if (body !== undefined) req.emit('data', body);
  req.emit('end');
  await done;
  return { status, headers, body: out };
}

describe('createProvider (fulfillment contract)', () => {
  it('answers the health check', async () => {
    const p = createProvider({ name: 'demo', fulfill: () => 'x' });
    const r = await invoke(p, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', provider: 'demo' });
  });

  it('passes action/taskId to the handler and JSON-encodes an object result', async () => {
    const fulfill = vi.fn(({ action, taskId }) => ({ echoed: action, taskId }));
    const p = createProvider({ fulfill });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'lookup', taskId: 't1' }));
    expect(fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lookup', taskId: 't1' }),
    );
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
    expect(JSON.parse(r.body)).toEqual({ echoed: 'lookup', taskId: 't1' });
  });

  it('sends a string result verbatim as text', async () => {
    const p = createProvider({ fulfill: () => 'plain result' });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.body).toBe('plain result');
  });

  it('tolerates a missing/invalid body (defaults action and taskId)', async () => {
    const fulfill = vi.fn(() => 'ok');
    const p = createProvider({ fulfill });
    const r = await invoke(p, 'POST', '/', 'not json');
    expect(r.status).toBe(200);
    expect(fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unknown', taskId: 'unknown' }),
    );
  });

  it('maps a thrown handler to HTTP 500 so the step fails', async () => {
    const p = createProvider({
      name: 'boom',
      fulfill: () => {
        throw new Error('provider down');
      },
      logger: { info: () => {}, error: () => {} },
    });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: 'provider down' });
  });

  it('warns when output exceeds what the worker will keep', async () => {
    const info = vi.fn();
    const p = createProvider({
      fulfill: () => 'x'.repeat(MAX_OUTPUT_CHARS + 1),
      logger: { info, error: () => {} },
    });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    expect(r.status).toBe(200);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('truncate'));
  });

  it('404s anything that is not a POST or the health check', async () => {
    const p = createProvider({ fulfill: () => 'x' });
    const r = await invoke(p, 'GET', '/');
    expect(r.status).toBe(404);
  });
});
