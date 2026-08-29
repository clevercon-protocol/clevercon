/**
 * search_agents MCP tool
 * 
 * Searches for agents by capability and category using the registry API.
 * Returns agent manifests with reputation data.
 */

import type { AgentRecord } from '@clevercon/common';

export const searchAgentsSchema = {
  name: 'search_agents',
  description: 'Search for agents by capability and optional category',
  inputSchema: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        description: 'Required capability to search for (e.g. "web-scraping", "data-analysis")',
      },
      category: {
        type: 'string',
        description: 'Optional category filter (e.g. "Data and Oracles", "AI and Analysis")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
        default: 10,
      },
    },
    required: ['capability'],
  },
};

export async function searchAgentsHandler(
  args: Record<string, unknown>,
  config: { registry_url: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { capability, category, limit = 10 } = args;

    if (typeof capability !== 'string' || capability.trim() === '') {
      throw new Error('capability must be a non-empty string');
    }

    if (category !== undefined && typeof category !== 'string') {
      throw new Error('category must be a string if provided');
    }

    if (typeof limit !== 'number' || limit <= 0) {
      throw new Error('limit must be a positive number');
    }

    // Build search parameters
    const searchParams = new URLSearchParams({
      capability: capability.trim(),
    });

    if (category) {
      searchParams.append('category', category.trim());
    }

    // Call registry search endpoint
    const response = await fetch(
      `${config.registry_url}/search?${searchParams.toString()}`
    );

    if (!response.ok) {
      throw new Error(
        `Registry search failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const agents: AgentRecord[] = Array.isArray(data) ? data : data.agents || [];

    // Apply limit
    const limitedAgents = agents.slice(0, limit as number);

    // Format results
    const results = limitedAgents.map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      pricing: agent.pricing,
      endpoint: agent.endpoint,
      stellar_address: agent.stellar_address,
      status: agent.status,
      reputation: {
        score: agent.reputation.score,
        total_jobs: agent.reputation.total_jobs,
        successful_jobs: agent.reputation.successful_jobs,
        avg_quality: agent.reputation.avg_quality,
        avg_latency_ms: agent.reputation.avg_latency_ms,
      },
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: {
              capability,
              category: category || null,
              limit,
            },
            results_count: results.length,
            total_available: agents.length,
            agents: results,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Search failed',
            message: error instanceof Error ? error.message : String(error),
            query: { capability: args.capability, category: args.category },
          }, null, 2),
        },
      ],
    };
  }
}