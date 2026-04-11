import type { AgentRecord, AgentFeedback } from '@clevercon/common';

export function calculateScore(reputation: AgentRecord['reputation']): number {
  if (reputation.total_jobs === 0) return 50;

  const successRate = reputation.successful_jobs / reputation.total_jobs;
  const normalizedQuality = reputation.avg_quality / 5.0;
  const speedScore = Math.max(0, 1 - reputation.avg_latency_ms / 10000);
  const experienceBonus = Math.min(1, reputation.total_jobs / 50);

  const score =
    successRate * 0.40 +
    normalizedQuality * 0.35 +
    speedScore * 0.15 +
    experienceBonus * 0.10;

  return Math.round(score * 100);
}

export function updateReputation(agent: AgentRecord, feedback: AgentFeedback): AgentRecord {
  const rep = { ...agent.reputation };

  rep.total_jobs += 1;
  if (feedback.success) {
    rep.successful_jobs += 1;
  } else {
    rep.failed_jobs += 1;
  }

  // Rolling average for quality
  rep.avg_quality =
    (rep.avg_quality * (rep.total_jobs - 1) + feedback.quality_rating) / rep.total_jobs;

  // Rolling average for latency
  rep.avg_latency_ms =
    (rep.avg_latency_ms * (rep.total_jobs - 1) + feedback.latency_ms) / rep.total_jobs;

  rep.score = calculateScore(rep);
  rep.last_updated = new Date().toISOString();

  return { ...agent, reputation: rep };
}
