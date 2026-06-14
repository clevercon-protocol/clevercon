import { describe, it, expect } from 'vitest';
import type { AgentRecord, AgentFeedback } from '@clevercon/common';
import { calculateScore, updateReputation } from './reputation.js';

function makeAgent(overrides: Partial<AgentRecord['reputation']> = {}): AgentRecord {
  return {
    agent_id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    capabilities: ['testing'],
    pricing: { model: 'x402', price_per_call: 0.01, currency: 'USDC' },
    endpoint: 'http://localhost:4000',
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
      ...overrides,
    },
  };
}

describe('calculateScore', () => {
  it('returns 50 for a brand-new agent with no jobs', () => {
    const score = calculateScore(makeAgent().reputation);
    expect(score).toBe(50);
  });

  it('returns 100 for a perfect, fast, experienced agent', () => {
    const score = calculateScore(
      makeAgent({
        total_jobs: 50,
        successful_jobs: 50,
        failed_jobs: 0,
        avg_quality: 5,
        avg_latency_ms: 0,
      }).reputation,
    );
    expect(score).toBe(100);
  });

  it('penalizes failures, low quality, and high latency', () => {
    const score = calculateScore(
      makeAgent({
        total_jobs: 10,
        successful_jobs: 5,
        failed_jobs: 5,
        avg_quality: 2.5,
        avg_latency_ms: 10000,
      }).reputation,
    );
    // successRate 0.5*0.40 + normalizedQuality 0.5*0.35 + speedScore 0*0.15 + experienceBonus (10/50=0.2)*0.10
    // = 0.20 + 0.175 + 0 + 0.02 = 0.395 -> 40
    expect(score).toBe(40);
  });

  it('caps the experience bonus at 50 total jobs', () => {
    const at50 = calculateScore(
      makeAgent({
        total_jobs: 50,
        successful_jobs: 50,
        avg_quality: 4,
        avg_latency_ms: 1000,
      }).reputation,
    );
    const at500 = calculateScore(
      makeAgent({
        total_jobs: 500,
        successful_jobs: 500,
        avg_quality: 4,
        avg_latency_ms: 1000,
      }).reputation,
    );
    expect(at50).toBe(at500);
  });
});

describe('updateReputation', () => {
  const feedback: AgentFeedback = {
    agent_id: 'agent-1',
    job_id: 'job-1',
    success: true,
    quality_rating: 5,
    latency_ms: 500,
    timestamp: '2026-01-02T00:00:00.000Z',
  };

  it('increments total_jobs and successful_jobs on success', () => {
    const agent = makeAgent();
    const updated = updateReputation(agent, feedback);

    expect(updated.reputation.total_jobs).toBe(1);
    expect(updated.reputation.successful_jobs).toBe(1);
    expect(updated.reputation.failed_jobs).toBe(0);
  });

  it('increments failed_jobs on failure', () => {
    const agent = makeAgent();
    const updated = updateReputation(agent, { ...feedback, success: false, quality_rating: 1 });

    expect(updated.reputation.total_jobs).toBe(1);
    expect(updated.reputation.successful_jobs).toBe(0);
    expect(updated.reputation.failed_jobs).toBe(1);
  });

  it('computes a rolling average for quality and latency', () => {
    const agent = makeAgent({
      total_jobs: 1,
      successful_jobs: 1,
      avg_quality: 4,
      avg_latency_ms: 1000,
    });
    const updated = updateReputation(agent, { ...feedback, quality_rating: 2, latency_ms: 2000 });

    expect(updated.reputation.total_jobs).toBe(2);
    expect(updated.reputation.avg_quality).toBe(3); // (4*1 + 2) / 2
    expect(updated.reputation.avg_latency_ms).toBe(1500); // (1000*1 + 2000) / 2
  });

  it('recomputes the score and updates last_updated', () => {
    const agent = makeAgent();
    const updated = updateReputation(agent, feedback);

    expect(updated.reputation.score).toBe(calculateScore(updated.reputation));
    expect(updated.reputation.last_updated).not.toBe(agent.reputation.last_updated);
  });

  it('does not mutate the original agent', () => {
    const agent = makeAgent();
    const original = JSON.parse(JSON.stringify(agent));
    updateReputation(agent, feedback);

    expect(agent).toEqual(original);
  });
});
