import type { AgentRecord } from '@clevercon/common';

/**
 * Filter and rank agents by requested capabilities.
 *
 * If `requestedCapabilities` is empty, every agent is returned, sorted by
 * reputation score descending. Otherwise an agent matches if any requested
 * capability is a case-insensitive substring of (or is itself a substring
 * of) one of the agent's declared capabilities. Matches are sorted by
 * reputation score descending.
 */
export function matchCapabilities(
  agents: AgentRecord[],
  requestedCapabilities: string[],
): AgentRecord[] {
  if (!requestedCapabilities || requestedCapabilities.length === 0) {
    return [...agents].sort((a, b) => b.reputation.score - a.reputation.score);
  }

  const requested = requestedCapabilities.map((c) => c.toLowerCase().trim());

  const matched = agents.filter((agent) => {
    const agentCaps = agent.capabilities.map((c) => c.toLowerCase());
    return requested.some((req) => agentCaps.some((cap) => cap.includes(req) || req.includes(cap)));
  });

  return matched.sort((a, b) => b.reputation.score - a.reputation.score);
}
