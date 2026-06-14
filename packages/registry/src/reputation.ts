import type { AgentRecord, AgentFeedback } from '@clevercon/common';

/**
 * Compute an agent's overall reputation score (0-100) from its track record.
 *
 * A brand-new agent (no completed jobs) gets a neutral score of 50. Otherwise
 * the score is a weighted blend of success rate (40%), feedback quality (35%),
 * response speed (15%), and experience (10%) — see docs/architecture.md for
 * the full breakdown.
 */
export function calculateScore(reputation: AgentRecord['reputation']): number {
  if (reputation.total_jobs === 0) return 50;

  const successRate = reputation.successful_jobs / reputation.total_jobs;
  const normalizedQuality = reputation.avg_quality / 5.0;
  const speedScore = Math.max(0, 1 - reputation.avg_latency_ms / 10000);
  const experienceBonus = Math.min(1, reputation.total_jobs / 50);

  const score =
    successRate * 0.4 + normalizedQuality * 0.35 + speedScore * 0.15 + experienceBonus * 0.1;

  return Math.round(score * 100);
}

/**
 * Apply a single job's feedback to an agent's reputation.
 *
 * Increments job counters, rolls `avg_quality` and `avg_latency_ms` into
 * running averages, and recomputes `score` via {@link calculateScore}.
 * Returns a new {@link AgentRecord} — the input `agent` is not mutated.
 */
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
