import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { app } from './server.js';
import { resetMetrics, stepExecuted, stepFailed, taskStarted, usdcReleased } from './metrics.js';

describe('GET /metrics', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    resetMetrics();
  });

  it('returns JSON with the documented shape', async () => {
    const res = await fetch(`${baseUrl}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = await res.json();
    expect(body).toMatchObject({
      uptime_seconds: expect.any(Number),
      tasks: {
        total: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        interrupted: expect.any(Number),
      },
      steps: {
        executed: expect.any(Number),
        failed: expect.any(Number),
        timed_out: expect.any(Number),
      },
      usdc_released_total: expect.any(Number),
      step_duration_ms: { count: expect.any(Number) },
      memory: {
        rss_bytes: expect.any(Number),
        heap_used_bytes: expect.any(Number),
      },
    });
  });

  it('reflects live counter state', async () => {
    taskStarted('metrics-endpoint-task');
    stepExecuted(120);
    stepFailed('signal timed out', 15000);
    usdcReleased(0.02);

    const body = await (await fetch(`${baseUrl}/metrics`)).json();

    expect(body.tasks).toMatchObject({ total: 1, active: 1 });
    expect(body.steps).toEqual({ executed: 2, failed: 1, timed_out: 1 });
    expect(body.usdc_released_total).toBe(0.02);
    expect(body.step_duration_ms).toMatchObject({ count: 2, max_ms: 15000, p50_ms: 120 });
  });

  it('does not require authentication or a user address', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
  });
});
