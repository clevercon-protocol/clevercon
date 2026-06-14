import { describe, it, expect } from 'vitest';
import type { AgentRecord } from '@clevercon/common';
import { matchCapabilities } from './search.js';

function makeAgent(agent_id: string, capabilities: string[], score: number): AgentRecord {
  return {
    agent_id,
    name: agent_id,
    description: '',
    capabilities,
    pricing: { model: 'x402', price_per_call: 0.01, currency: 'USDC' },
    endpoint: `http://localhost/${agent_id}`,
    stellar_address: 'GTEST',
    health_check: '/health',
    registered_at: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    status: 'active',
    reputation: {
      score,
      total_jobs: 0,
      successful_jobs: 0,
      failed_jobs: 0,
      avg_quality: 0,
      avg_latency_ms: 0,
      last_updated: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('matchCapabilities', () => {
  const webAgent = makeAgent('web-intel', ['web-search', 'news'], 70);
  const analysisAgent = makeAgent('analysis', ['data-analysis', 'trend-analysis'], 90);
  const oracleAgent = makeAgent('oracle', ['price-feed'], 40);
  const agents = [webAgent, analysisAgent, oracleAgent];

  it('returns all agents sorted by reputation when no capabilities are requested', () => {
    const result = matchCapabilities(agents, []);

    expect(result.map((a) => a.agent_id)).toEqual(['analysis', 'web-intel', 'oracle']);
  });

  it('matches agents whose capabilities contain the requested term', () => {
    const result = matchCapabilities(agents, ['analysis']);

    expect(result.map((a) => a.agent_id)).toEqual(['analysis']);
  });

  it('matches case-insensitively and via substring in either direction', () => {
    const result = matchCapabilities(agents, ['DATA-ANALYSIS-DEEP']);

    expect(result.map((a) => a.agent_id)).toEqual(['analysis']);
  });

  it('returns multiple matches sorted by reputation score', () => {
    const result = matchCapabilities(agents, ['analysis', 'web-search']);

    expect(result.map((a) => a.agent_id)).toEqual(['analysis', 'web-intel']);
  });

  it('returns an empty array when nothing matches', () => {
    const result = matchCapabilities(agents, ['nonexistent-capability']);

    expect(result).toEqual([]);
  });
});
