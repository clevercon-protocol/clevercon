import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRegistryClient } from './registry.js';
import type { RegistrationPayload } from './types.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const manifest: RegistrationPayload = {
  agent_id: 'demo',
  name: 'Demo',
  description: 'd',
  capabilities: ['demo'],
  pricing: { model: 'x402', price_per_call: 0.02, currency: 'USDC' },
  endpoint: 'http://localhost:4001/query',
  stellar_address: 'GDEMO',
  health_check: 'http://localhost:4001/health',
};

function client(fetchImpl: unknown) {
  return createRegistryClient({
    registryUrl: 'http://reg',
    manifest,
    requesterAddress: 'GDEMO',
    logger: silentLogger,
    fetchImpl: fetchImpl as typeof fetch,
    heartbeatMs: 0,
  });
}

const bodyOf = (call: unknown[]): Record<string, unknown> =>
  JSON.parse((call[1] as { body: string }).body);

describe('reportFeedback', () => {
  afterEach(() => vi.clearAllMocks());

  it('POSTs the feedback shape the registry /feedback route requires', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await client(fetchImpl).reportFeedback('job-1', {
      success: true,
      quality_rating: 5,
      latency_ms: 1234,
    });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://reg/feedback');
    const body = bodyOf(fetchImpl.mock.calls[0]);
    expect(body).toMatchObject({
      agent_id: 'demo',
      job_id: 'job-1',
      success: true,
      quality_rating: 5,
      latency_ms: 1234,
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('defaults quality_rating to 3 on success and 1 on failure (matches the orchestrator)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const c = client(fetchImpl);
    await c.reportFeedback('ok', { success: true });
    await c.reportFeedback('bad', { success: false });
    expect(bodyOf(fetchImpl.mock.calls[0]).quality_rating).toBe(3);
    expect(bodyOf(fetchImpl.mock.calls[1]).quality_rating).toBe(1);
  });

  it('throws when the registry rejects the feedback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(client(fetchImpl).reportFeedback('x', { success: true })).rejects.toThrow(/404/);
  });
});
