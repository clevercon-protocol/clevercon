import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('./capability-check.js', () => ({
  checkFeasibility: vi.fn(),
}));

vi.mock('./planner.js', () => ({
  createPlan: vi.fn(),
}));

import { checkFeasibility } from './capability-check.js';
import { createPlan } from './planner.js';
import { app } from './server.js';

const mockAgent = {
  agent_id: 'agent-test-1',
  name: 'Test Agent',
  description: 'A test agent',
  capabilities: ['data-analysis'],
  pricing: { model: 'x402' as const, price_per_call: 0.01, currency: 'USDC' as const },
  endpoint: 'http://localhost:5100',
  stellar_address: 'GTESTADDRESS',
  health_check: '/health',
  registered_at: '2026-01-01T00:00:00.000Z',
  last_seen: '2026-01-01T00:00:00.000Z',
  status: 'active' as const,
  reputation: {
    score: 80,
    total_jobs: 10,
    successful_jobs: 9,
    failed_jobs: 1,
    avg_quality: 4.5,
    avg_latency_ms: 200,
    last_updated: '2026-01-01T00:00:00.000Z',
  },
};

describe('POST /api/tasks/preview', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when no agents are registered', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'analyze this dataset' }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('no_agents');
  });

  it('returns 503 when registry is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'analyze this dataset' }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('registry_unavailable');
  });

  it('returns 200 with full step shape on happy path using prompt field', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([mockAgent]),
    } as Response);

    vi.mocked(checkFeasibility).mockResolvedValueOnce({
      feasible: true,
      needed: ['data-analysis'],
      available: ['data-analysis'],
      missing: [],
    });

    vi.mocked(createPlan).mockResolvedValueOnce({
      steps: [
        {
          step_id: 1,
          agent_id: 'agent-test-1',
          agent_name: 'Test Agent',
          action: 'Analyze the dataset and return insights',
          depends_on: null,
          estimated_cost: 0.01,
          payment_method: 'x402',
        },
      ],
      total_estimated_cost: 0.01,
      reasoning: 'Use the test agent for data analysis.',
    });

    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'analyze this dataset', budget: 1.0 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feasible).toBe(true);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).toMatchObject({
      agent_id: 'agent-test-1',
      action: 'Analyze the dataset and return insights',
      estimated_cost: 0.01,
      endpoint: 'http://localhost:5100',
    });
    expect(body.total_estimated_cost).toBe(0.01);
    expect(body.over_budget).toBe(false);
  });

  it('accepts task field as alias for prompt', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([mockAgent]),
    } as Response);

    vi.mocked(checkFeasibility).mockResolvedValueOnce({
      feasible: true,
      needed: ['data-analysis'],
      available: ['data-analysis'],
      missing: [],
    });

    vi.mocked(createPlan).mockResolvedValueOnce({
      steps: [
        {
          step_id: 1,
          agent_id: 'agent-test-1',
          agent_name: 'Test Agent',
          action: 'do something',
          depends_on: null,
          estimated_cost: 0.01,
          payment_method: 'x402',
        },
      ],
      total_estimated_cost: 0.01,
      reasoning: 'Single step plan.',
    });

    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'analyze this dataset' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feasible).toBe(true);
  });

  it('returns 422 when feasibility check reports task as infeasible', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([mockAgent]),
    } as Response);

    vi.mocked(checkFeasibility).mockResolvedValueOnce({
      feasible: false,
      needed: ['quantum-compute', 'time-travel'],
      available: [],
      missing: ['quantum-compute', 'time-travel'],
    });

    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'do something impossible' }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.feasible).toBe(false);
    expect(body.missing).toContain('quantum-compute');
    expect(body.missing).toContain('time-travel');
    expect(body.message).toMatch(/missing/i);
  });

  it('returns 400 when neither task nor prompt is provided', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget: 1.0 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('task is required');
  });
});
