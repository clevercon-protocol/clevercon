import { describe, it, expect, vi } from 'vitest';
import { buildUrl, createApiClient, ApiError, toolError } from './api-client.js';

describe('buildUrl', () => {
  it('appends only defined, non-empty query params', () => {
    const url = buildUrl('http://api.test', '/tasks', {
      status: 'RUNNING',
      limit: 5,
      offset: 0,
      category: undefined,
      q: '',
    });
    expect(url).toBe('http://api.test/tasks?status=RUNNING&limit=5&offset=0');
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(buildUrl('http://api.test/', '/services')).toBe('http://api.test/services');
  });
});

describe('createApiClient', () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends the API key header and returns parsed JSON', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { id: 't1' }),
    );
    const client = createApiClient(
      { api_url: 'http://api.test', api_key: 'cc_abc.secret' },
      fetchImpl as unknown as typeof fetch,
    );
    const out = await client.post('/tasks', { title: 'go', mode: 'SEARCH', budget: 1 });
    expect(out).toEqual({ id: 't1' });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'cc_abc.secret' });
    expect((init as RequestInit).method).toBe('POST');
  });

  it('omits the key header when unauthenticated', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, []));
    const client = createApiClient(
      { api_url: 'http://api.test' },
      fetchImpl as unknown as typeof fetch,
    );
    await client.get('/services');
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).not.toHaveProperty('x-api-key');
  });

  it('maps 429 to a quota ApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { message: 'Daily API quota exceeded' }));
    const client = createApiClient(
      { api_url: 'http://api.test', api_key: 'k' },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.get('/tasks')).rejects.toMatchObject({ status: 429 });
  });

  it('maps 401 to a clear auth ApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'Invalid API key' }));
    const client = createApiClient(
      { api_url: 'http://api.test' },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.get('/tasks')).rejects.toThrow(/Unauthorized/);
  });
});

describe('toolError', () => {
  it('formats an ApiError with its status', () => {
    const res = toolError('hire_agent failed', new ApiError(429, 'Daily API quota exceeded'));
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.error).toBe('hire_agent failed');
    expect(parsed.message).toContain('429');
  });
});
