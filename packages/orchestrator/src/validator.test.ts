import { describe, it, expect } from 'vitest';
import type { AgentRecord, ExecutionPlan, ExecutionStep } from '@clevercon/common';
import { validatePlan } from './validator.js';

function makeAgent(agent_id: string, model: 'x402' | 'mpp' = 'x402'): AgentRecord {
  return {
    agent_id,
    name: agent_id,
    description: '',
    capabilities: [],
    pricing: { model, price_per_call: 0.01, currency: 'USDC' },
    endpoint: `http://localhost/${agent_id}`,
    stellar_address: 'GTEST',
    health_check: '/health',
    registered_at: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    status: 'active',
    reputation: {
      score: 50,
      total_jobs: 0,
      successful_jobs: 0,
      failed_jobs: 0,
      avg_quality: 0,
      avg_latency_ms: 0,
      last_updated: '2026-01-01T00:00:00.000Z',
    },
  };
}

function makeStep(opts: {
  step_id: number;
  agent_id: string;
  depends_on?: ExecutionStep['depends_on'];
  estimated_cost?: number;
  payment_method?: ExecutionStep['payment_method'];
}): ExecutionStep {
  return {
    step_id: opts.step_id,
    agent_id: opts.agent_id,
    agent_name: opts.agent_id,
    action: 'do something',
    depends_on: opts.depends_on ?? null,
    estimated_cost: opts.estimated_cost ?? 0.01,
    payment_method: opts.payment_method ?? 'x402',
  };
}

describe('validatePlan', () => {
  const agents = [makeAgent('agent-a', 'x402'), makeAgent('agent-b', 'mpp')];

  it('accepts a valid single-step plan within budget', () => {
    const plan: ExecutionPlan = {
      steps: [makeStep({ step_id: 1, agent_id: 'agent-a' })],
      total_estimated_cost: 0.01,
      reasoning: 'test',
    };

    expect(validatePlan(plan, agents, 1)).toEqual({ valid: true, errors: [] });
  });

  it('flags an unknown agent_id', () => {
    const plan: ExecutionPlan = {
      steps: [makeStep({ step_id: 1, agent_id: 'unknown-agent' })],
      total_estimated_cost: 0.01,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown agent_id'))).toBe(true);
  });

  it('flags a total cost that exceeds the budget', () => {
    const plan: ExecutionPlan = {
      steps: [makeStep({ step_id: 1, agent_id: 'agent-a', estimated_cost: 5 })],
      total_estimated_cost: 5,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds budget'))).toBe(true);
  });

  it('flags a forward/circular dependency', () => {
    const plan: ExecutionPlan = {
      steps: [
        makeStep({ step_id: 1, agent_id: 'agent-a', depends_on: 2 }),
        makeStep({ step_id: 2, agent_id: 'agent-a' }),
      ],
      total_estimated_cost: 0.02,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not earlier'))).toBe(true);
  });

  it('flags a dependency on an unknown step_id', () => {
    const plan: ExecutionPlan = {
      steps: [makeStep({ step_id: 1, agent_id: 'agent-a', depends_on: 99 })],
      total_estimated_cost: 0.01,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('depends_on unknown step_id'))).toBe(true);
  });

  it('accepts an array of dependencies that all reference earlier steps', () => {
    const plan: ExecutionPlan = {
      steps: [
        makeStep({ step_id: 1, agent_id: 'agent-a' }),
        makeStep({ step_id: 2, agent_id: 'agent-a' }),
        makeStep({ step_id: 3, agent_id: 'agent-a', depends_on: [1, 2] }),
      ],
      total_estimated_cost: 0.03,
      reasoning: 'test',
    };

    expect(validatePlan(plan, agents, 1)).toEqual({ valid: true, errors: [] });
  });

  it('flags a payment_method that does not match the agent pricing model', () => {
    const plan: ExecutionPlan = {
      steps: [makeStep({ step_id: 1, agent_id: 'agent-b', payment_method: 'x402' })],
      total_estimated_cost: 0.01,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not match agent'))).toBe(true);
  });

  it('flags a plan with no steps', () => {
    const plan: ExecutionPlan = {
      steps: [],
      total_estimated_cost: 0,
      reasoning: 'test',
    };

    const result = validatePlan(plan, agents, 1);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan has no steps');
  });
});
