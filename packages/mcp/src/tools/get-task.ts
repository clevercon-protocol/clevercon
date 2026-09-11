/**
 * get_task MCP tool
 *
 * Fetches one of the caller's tasks by id, including its steps and their
 * outputs, via the API. Requires an API key.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const getTaskSchema = {
  name: 'get_task',
  description:
    "Fetch one of the caller's tasks by id, including its steps and their outputs. Requires an API key.",
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The task id' } },
    required: ['id'],
  },
};

export async function getTaskHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { id } = args;
    if (typeof id !== 'string' || id.trim() === '')
      throw new Error('id must be a non-empty string');

    const client = createApiClient(config);
    const task = await client.get(`/tasks/${encodeURIComponent(id.trim())}`);
    return toolJson(task);
  } catch (error) {
    return toolError('get_task failed', error);
  }
}
