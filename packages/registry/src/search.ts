import type { AgentRecord } from '@clevercon/common';

export function matchCapabilities(
  agents: AgentRecord[],
  requestedCapabilities: string[]
): AgentRecord[] {
  if (!requestedCapabilities || requestedCapabilities.length === 0) {
    return [...agents].sort((a, b) => b.reputation.score - a.reputation.score);
  }

  const requested = requestedCapabilities.map(c => c.toLowerCase().trim());

  const matched = agents.filter(agent => {
    const agentCaps = agent.capabilities.map(c => c.toLowerCase());
    return requested.some(req =>
      agentCaps.some(
        cap => cap.includes(req) || req.includes(cap)
      )
    );
  });

  return matched.sort((a, b) => b.reputation.score - a.reputation.score);
}
