import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createProvider,
  MAX_OUTPUT_CHARS,
  artifactRef,
  sha256Hex,
  fetchAttachment,
} from './provider.js';

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

describe('createProvider (async lifecycle outcomes)', () => {
  it('encodes a completed outcome as an envelope with data + artifact', async () => {
    const artifact = { url: 'https://cdn/x.png', hash: 'sha256:ab', contentType: 'image/png', size: 9 };
    const p = createProvider({ fulfill: () => ({ status: 'completed', data: { ok: 1 }, artifact }) });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    const env = JSON.parse(r.body);
    expect(r.status).toBe(200);
    expect(env).toMatchObject({ ok: true, status: 'completed', data: { ok: 1 }, artifact });
    expect(env.issuedAt).toBeTypeOf('number');
  });

  it('encodes a working outcome with the handle + progress', async () => {
    const p = createProvider({
      fulfill: () => ({ status: 'working', handle: 'job-1', progress: { pct: 25 } }),
    });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    const env = JSON.parse(r.body);
    expect(env).toMatchObject({ ok: true, status: 'working', handle: 'job-1', progress: { pct: 25 } });
  });

  it('encodes an input_required outcome with the question', async () => {
    const p = createProvider({
      fulfill: () => ({ status: 'input_required', inputRequest: { requestId: 'q1', prompt: 'Which size?' } }),
    });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    const env = JSON.parse(r.body);
    expect(env).toMatchObject({
      ok: true,
      status: 'input_required',
      inputRequest: { requestId: 'q1', prompt: 'Which size?' },
    });
  });

  it('encodes a failed outcome as ok:false (200) so the error propagates', async () => {
    const p = createProvider({ fulfill: () => ({ status: 'failed', error: 'upstream down' }) });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't' }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false, status: 'failed', error: 'upstream down' });
  });

  it('passes the full job envelope (kind/handle/requestId/input/attachments) to the handler', async () => {
    const fulfill = vi.fn(() => ({ status: 'completed', data: 'ok' }));
    const p = createProvider({ fulfill });
    await invoke(
      p,
      'POST',
      '/',
      JSON.stringify({
        action: 'a',
        taskId: 't',
        jobId: 'step-9',
        kind: 'answer',
        handle: 'job-1',
        requestId: 'q1',
        inputResponse: { size: 'L' },
        input: { foo: 'bar' },
        attachments: [{ url: 'u', hash: 'sha256:aa', contentType: 'text/plain', size: 2 }],
        idempotencyKey: 't:step-9',
      }),
    );
    expect(fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'step-9',
        kind: 'answer',
        handle: 'job-1',
        requestId: 'q1',
        inputResponse: { size: 'L' },
        input: { foo: 'bar' },
        idempotencyKey: 't:step-9',
      }),
    );
    const req = fulfill.mock.calls[0][0] as { attachments: unknown[] };
    expect(req.attachments).toHaveLength(1);
  });

  it('signs a completed outcome when a signer is supplied', async () => {
    const sign = vi.fn(async (payload: string) => `sig(${payload.length})`);
    const p = createProvider({ fulfill: () => ({ status: 'completed', data: 'x' }), sign });
    const r = await invoke(p, 'POST', '/', JSON.stringify({ action: 'a', taskId: 't', jobId: 'j1' }));
    expect(sign).toHaveBeenCalledOnce();
    expect(JSON.parse(r.body).signature).toMatch(/^sig\(/);
  });
});

describe('provider helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('artifactRef computes a sha256 content hash + size', () => {
    const bytes = new TextEncoder().encode('hello');
    const ref = artifactRef('https://cdn/f.txt', bytes, 'text/plain');
    expect(ref).toEqual({
      url: 'https://cdn/f.txt',
      hash: `sha256:${sha256Hex(bytes)}`,
      contentType: 'text/plain',
      size: 5,
    });
  });

  it('fetchAttachment returns verified bytes and rejects a hash mismatch', async () => {
    const bytes = new TextEncoder().encode('payload');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const good = { url: 'https://x', hash: `sha256:${sha256Hex(bytes)}`, contentType: 'text/plain', size: bytes.byteLength };
    const got = await fetchAttachment(good);
    expect(new TextDecoder().decode(got.bytes)).toBe('payload');
    const bad = { ...good, hash: 'sha256:deadbeef' };
    await expect(fetchAttachment(bad)).rejects.toThrow(/mismatch/);
  });
});
