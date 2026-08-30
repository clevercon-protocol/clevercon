/**
 * estimate_cost MCP tool
 * 
 * Provides advisory pricing for a capability by looking at registry manifests.
 */

import type { AgentRecord } from '@clevercon/common';

export const estimateCostSchema = {
  name: 'estimate_cost',
  description: 'Estimate cost for a capability based on available agents',
  inputSchema: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        description: 'Capability to estimate cost for (e.g. "web-scraping", "data-analysis")',
      },
    },
    required: ['capability'],
  },
};

interface CostEstimate {
  capability: string;
  agents_found: number;
  pricing_summary: {
    min_price: number;
    max_price: number;
    avg_price: number;
    median_price: number;
    currency: 'USDC';
  };
  agent_prices: Array<{
    agent_id: string;
    name: string;
    price_per_call: number;
    pricing_model: 'x402' | 'mpp';
    reputation_score: number;
  }>;
  recommendation?: {
    agent_id: string;
    name: string;
    price_per_call: number;
    reason: string;
  };
}

export async function estimateCostHandler(
  args: Record<string, unknown>,
  config: { registry_url: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { capability } = args;

    if (typeof capability !== 'string' || capability.trim() === '') {
      throw new Error('capability must be a non-empty string');
    }

    const searchCapability = capability.trim();

    // Search for agents with this capability
    const searchParams = new URLSearchParams({
      capability: searchCapability,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    let response;
    try {
      response = await fetch(
        `${config.registry_url}/search?${searchParams.toString()}`,
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(
        `Registry search failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const agents: AgentRecord[] = Array.isArray(data) ? data : data.agents || [];

    if (agents.length === 0) {
      const result: CostEstimate = {
        capability: searchCapability,
        agents_found: 0,
        pricing_summary: {
          min_price: 0,
          max_price: 0,
          avg_price: 0,
          median_price: 0,
          currency: 'USDC',
        },
        agent_prices: [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    // Extract pricing information
    const agentPrices = agents.map(agent => ({
      agent_id: agent.agent_id,
      name: agent.name,
      price_per_call: agent.pricing.price_per_call,
      pricing_model: agent.pricing.model,
      reputation_score: agent.reputation.score,
    }));

    // Calculate pricing statistics
    const prices = agentPrices.map(a => a.price_per_call);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const medianPrice = sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)];

    // Find recommended agent (best reputation-to-price ratio)
    let recommendedAgent = agentPrices[0];
    let bestScore = 0;

    for (const agent of agentPrices) {
      // Score = reputation / (price + 0.01) to avoid division by zero
      const score = agent.reputation_score / (agent.price_per_call + 0.01);
      if (score > bestScore) {
        bestScore = score;
        recommendedAgent = agent;
      }
    }

    const result: CostEstimate = {
      capability: searchCapability,
      agents_found: agents.length,
      pricing_summary: {
        min_price: Math.round(minPrice * 1000000) / 1000000, // Round to 6 decimal places
        max_price: Math.round(maxPrice * 1000000) / 1000000,
        avg_price: Math.round(avgPrice * 1000000) / 1000000,
        median_price: Math.round(medianPrice * 1000000) / 1000000,
        currency: 'USDC',
      },
      agent_prices: agentPrices.map(agent => ({
        ...agent,
        price_per_call: Math.round(agent.price_per_call * 1000000) / 1000000,
      })),
      recommendation: {
        agent_id: recommendedAgent.agent_id,
        name: recommendedAgent.name,
        price_per_call: Math.round(recommendedAgent.price_per_call * 1000000) / 1000000,
        reason: `Best reputation-to-price ratio (${recommendedAgent.reputation_score.toFixed(2)} reputation score at ${recommendedAgent.price_per_call} USDC per call)`,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };

  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Cost estimation failed',
            message: error instanceof Error ? error.message : String(error),
            capability: args.capability,
          }, null, 2),
        },
      ],
    };
  }
}