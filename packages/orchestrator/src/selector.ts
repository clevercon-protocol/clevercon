import type { AgentRecord } from '@clevercon/common';

export interface ScoredAgent {
  agent: AgentRecord;
  score: number;
  breakdown: {
    capability_match: number;
    reputation: number;
    price_efficiency: number;
    latency_score: number;
    discovery_bonus: number;
  };
}

// Weights from spec Section 10
const WEIGHTS = {
  capability_match: 0.35,
  reputation: 0.3,
  price_efficiency: 0.15,
  latency: 0.1,
  discovery_bonus: 0.1,
};

/**
 * Score and rank agents for a step that needs `neededCapabilities`.
 *
 * Each agent receives a 0-1 score per criterion — capability match, normalized
 * reputation, price efficiency relative to `maxPriceUSDC`, latency, and a
 * "new agent" discovery bonus — combined via {@link WEIGHTS} into an overall
 * `score`. Results are sorted by `score` descending. This is distinct from
 * (and uses different weights than) the registry's reputation score — see
 * docs/architecture.md for both formulas.
 */
export function scoreAgents(
  agents: AgentRecord[],
  neededCapabilities: string[],
  maxPriceUSDC: number = 0.1,
): ScoredAgent[] {
  return agents
    .map((agent) => {
      // Capability match: fraction of needed caps covered
      const matchCount =
        neededCapabilities.length === 0
          ? 1
          : neededCapabilities.filter((nc) =>
              agent.capabilities.some(
                (ac) =>
                  ac.toLowerCase().includes(nc.toLowerCase()) ||
                  nc.toLowerCase().includes(ac.toLowerCase()),
              ),
            ).length;
      const capability_match =
        neededCapabilities.length === 0 ? 1 : matchCount / neededCapabilities.length;

      // Reputation: 0-100 normalised to 0-1
      const reputation = (agent.reputation?.score ?? 50) / 100;

      // Price efficiency: cheaper relative to max budget = higher score
      const price = agent.pricing.price_per_call;
      const price_efficiency = maxPriceUSDC > 0 ? Math.max(0, 1 - price / maxPriceUSDC) : 0.5;

      // Latency: 0ms = 1.0, 10000ms = 0.0
      const avgLatency = agent.reputation?.avg_latency_ms ?? 2000;
      const latency_score = Math.max(0, 1 - avgLatency / 10000);

      // Discovery bonus: new agents (< 5 jobs) get a boost
      const totalJobs = agent.reputation?.total_jobs ?? 0;
      const discovery_bonus = totalJobs < 5 ? 1.0 : 0.0;

      const score =
        capability_match * WEIGHTS.capability_match +
        reputation * WEIGHTS.reputation +
        price_efficiency * WEIGHTS.price_efficiency +
        latency_score * WEIGHTS.latency +
        discovery_bonus * WEIGHTS.discovery_bonus;

      return {
        agent,
        score: Math.round(score * 100) / 100,
        breakdown: {
          capability_match: Math.round(capability_match * 100) / 100,
          reputation: Math.round(reputation * 100) / 100,
          price_efficiency: Math.round(price_efficiency * 100) / 100,
          latency_score: Math.round(latency_score * 100) / 100,
          discovery_bonus,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the single best agent for `neededCapabilities` from `agents`.
 *
 * Scores all agents via {@link scoreAgents}, then — if capabilities were
 * requested — discards any agent with zero capability match. Returns the
 * top-scoring remaining agent, or `null` if none qualify.
 */
export function selectBestAgent(
  agents: AgentRecord[],
  neededCapabilities: string[],
  maxPriceUSDC?: number,
): ScoredAgent | null {
  const scored = scoreAgents(agents, neededCapabilities, maxPriceUSDC);
  // Only return agents that match at least one needed capability
  const candidates =
    neededCapabilities.length === 0
      ? scored
      : scored.filter((s) => s.breakdown.capability_match > 0);
  return candidates[0] ?? null;
}
