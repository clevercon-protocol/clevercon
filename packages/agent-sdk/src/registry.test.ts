import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRegistryClient, RETRY_DELAYS_MS } from './registry.js';
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

function ok() {
  return { ok: true, status: 200 } as Response;
}
function fail() {
  return { ok: false, status: 503 } as Response;
}

describe('createRegistryClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('POSTs the manifest to <registry>/register', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const client = createRegistryClient({
      registryUrl: 'http://reg',
      manifest,
      requesterAddress: 'GDEMO',
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      heartbeatMs: 0,
    });
    await client.registerSelf();
    expect(fetchImpl).toHaveBeenCalledWith('http://reg/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
  });

  it('retries on the [5s,15s,30s,60s] backoff until the registry is up', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail())
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ok());
    const client = createRegistryClient({
      registryUrl: 'http://reg',
      manifest,
      requesterAddress: 'GDEMO',
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      heartbeatMs: 0,
    });

    await client.registerSelf();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // succeeded

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[3]);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // no more retries after success
  });

  it('re-registers on the heartbeat interval after a successful registration', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const client = createRegistryClient({
      registryUrl: 'http://reg',
      manifest,
      requesterAddress: 'GDEMO',
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      heartbeatMs: 60_000,
    });
    await client.registerSelf();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('deregister sends DELETE with the agent address as requester_address', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const client = createRegistryClient({
      registryUrl: 'http://reg',
      manifest,
      requesterAddress: 'GDEMO',
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      heartbeatMs: 0,
    });
    await client.deregister();
    expect(fetchImpl).toHaveBeenCalledWith('http://reg/agents/demo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_address: 'GDEMO' }),
    });
  });

  it('deregister stops further registration retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail()).mockResolvedValue(ok());
    const client = createRegistryClient({
      registryUrl: 'http://reg',
      manifest,
      requesterAddress: 'GDEMO',
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      heartbeatMs: 0,
    });
    await client.registerSelf(); // fails, schedules retry
    await client.deregister(); // cancels it
    fetchImpl.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] * 4);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
