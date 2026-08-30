/**
 * get_agent MCP tool
 *
 * Retrieves detailed information about a specific agent by ID.
 */

import type { AgentRecord } from '@clevercon/common';

export const getAgentSchema = {
  name: 'get_agent',
  description: 'Get detailed information about a specific agent by ID',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The agent ID to look up',
      },
    },
    required: ['id'],
  },
};

export async function getAgentHandler(
  args: Record<string, unknown>,
  config: { registry_url: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { id } = args;

    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('id must be a non-empty string');
    }

    const agentId = id.trim();

    // Call registry to get agent details
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    let response;
    try {
      response = await fetch(`${config.registry_url}/agents/${encodeURIComponent(agentId)}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                found: false,
                agent_id: agentId,
                message: 'Agent not found',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (!response.ok) {
      throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
    }

    const agent: AgentRecord = await response.json();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              found: true,
              agent: {
                agent_id: agent.agent_id,
                name: agent.name,
                description: agent.description,
                capabilities: agent.capabilities,
                pricing: agent.pricing,
                endpoint: agent.endpoint,
                stellar_address: agent.stellar_address,
                health_check: agent.health_check,
                status: agent.status,
                registered_at: agent.registered_at,
                last_seen: agent.last_seen,
                registered_by: agent.registered_by,
                reputation: {
                  score: agent.reputation.score,
                  total_jobs: agent.reputation.total_jobs,
                  successful_jobs: agent.reputation.successful_jobs,
                  failed_jobs: agent.reputation.failed_jobs,
                  avg_quality: agent.reputation.avg_quality,
                  avg_latency_ms: agent.reputation.avg_latency_ms,
                  last_updated: agent.reputation.last_updated,
                },
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'Get agent failed',
              message: error instanceof Error ? error.message : String(error),
              agent_id: args.id,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
