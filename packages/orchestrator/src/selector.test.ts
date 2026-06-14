import { describe, it, expect } from 'vitest';
import type { AgentRecord } from '@clevercon/common';
import { scoreAgents, selectBestAgent } from './selector.js';

function makeAgent(opts: {
  agent_id: string;
  capabilities?: string[];
  pricing?: AgentRecord['pricing'];
  reputation?: Partial<AgentRecord['reputation']>;
}): AgentRecord {
  return {
    agent_id: opts.agent_id,
    name: opts.agent_id,
    description: '',
    capabilities: opts.capabilities ?? [],
    pricing: opts.pricing ?? { model: 'x402', price_per_call: 0.01, currency: 'USDC' },
    endpoint: `http://localhost/${opts.agent_id}`,
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
      ...opts.reputation,
    },
  };
}

describe('scoreAgents', () => {
  it('gives full capability_match when no capabilities are needed', () => {
    const agent = makeAgent({ agent_id: 'a', capabilities: ['anything'] });

    const [scored] = scoreAgents([agent], []);

    expect(scored.breakdown.capability_match).toBe(1);
  });

  it('computes a weighted score from reputation, price, latency, and discovery bonus', () => {
    const agent = makeAgent({
      agent_id: 'agent-a',
      capabilities: ['data-analysis'],
      pricing: { model: 'x402', price_per_call: 0, currency: 'USDC' },
      reputation: { score: 80, total_jobs: 10, avg_latency_ms: 0 },
    });

    const [scored] = scoreAgents([agent], ['data-analysis'], 0.1);

    expect(scored.breakdown).toEqual({
      capability_match: 1,
      reputation: 0.8,
      price_efficiency: 1,
      latency_score: 1,
      discovery_bonus: 0,
    });
    expect(scored.score).toBeCloseTo(0.84, 2);
  });

  it('gives a discovery bonus to agents with fewer than 5 completed jobs', () => {
    const newAgent = makeAgent({
      agent_id: 'new',
      capabilities: ['data-analysis'],
      reputation: { total_jobs: 0 },
    });
    const veteranAgent = makeAgent({
      agent_id: 'veteran',
      capabilities: ['data-analysis'],
      reputation: { total_jobs: 100 },
    });

    const [newScored] = scoreAgents([newAgent], ['data-analysis']);
    const [veteranScored] = scoreAgents([veteranAgent], ['data-analysis']);

    expect(newScored.breakdown.discovery_bonus).toBe(1);
    expect(veteranScored.breakdown.discovery_bonus).toBe(0);
  });

  it('gives partial capability_match when only some needed capabilities are covered', () => {
    const agent = makeAgent({ agent_id: 'agent-a', capabilities: ['data-analysis'] });

    const [scored] = scoreAgents([agent], ['data-analysis', 'report-writing']);

    expect(scored.breakdown.capability_match).toBe(0.5);
  });

  it('sorts results by score descending', () => {
    const low = makeAgent({ agent_id: 'low', capabilities: ['x'], reputation: { score: 10 } });
    const high = makeAgent({ agent_id: 'high', capabilities: ['x'], reputation: { score: 90 } });

    const scored = scoreAgents([low, high], ['x']);

    expect(scored.map((s) => s.agent.agent_id)).toEqual(['high', 'low']);
  });
});

describe('selectBestAgent', () => {
  it('returns the highest-scoring agent that matches a needed capability', () => {
    const matching = makeAgent({
      agent_id: 'match',
      capabilities: ['data-analysis'],
      reputation: { score: 90 },
    });
    const nonMatching = makeAgent({
      agent_id: 'no-match',
      capabilities: ['report-writing'],
      reputation: { score: 100 },
    });

    const best = selectBestAgent([matching, nonMatching], ['data-analysis']);

    expect(best?.agent.agent_id).toBe('match');
  });

  it('returns null when no agent covers any needed capability', () => {
    const agent = makeAgent({ agent_id: 'agent-a', capabilities: ['report-writing'] });

    const best = selectBestAgent([agent], ['data-analysis']);

    expect(best).toBeNull();
  });

  it('returns the top-scoring agent when no capabilities are required', () => {
    const low = makeAgent({ agent_id: 'low', reputation: { score: 10 } });
    const high = makeAgent({ agent_id: 'high', reputation: { score: 90 } });

    const best = selectBestAgent([low, high], []);

    expect(best?.agent.agent_id).toBe('high');
  });
});
