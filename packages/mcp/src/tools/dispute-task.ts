/**
 * dispute_task MCP tool
 *
 * Raises a dispute on one of the caller's tasks via the API. Requires an API key.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const disputeTaskSchema = {
  name: 'dispute_task',
  description: "Raise a dispute on one of the caller's tasks. Requires an API key.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The task id' },
      reason: { type: 'string', maxLength: 1000 },
    },
    required: ['id'],
  },
};

export async function disputeTaskHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { id, reason } = args;
    if (typeof id !== 'string' || id.trim() === '')
      throw new Error('id must be a non-empty string');

    const client = createApiClient(config);
    const result = await client.post(`/tasks/${encodeURIComponent(id.trim())}/dispute`, {
      reason: typeof reason === 'string' ? reason : undefined,
    });
    return toolJson(result);
  } catch (error) {
    return toolError('dispute_task failed', error);
  }
}
