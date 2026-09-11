/**
 * list_tasks MCP tool
 *
 * Lists the caller's tasks (buyer-scoped) via the API, optionally filtered by
 * status. Requires an API key.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

const STATUSES = ['DRAFT', 'PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'FAILED'];

export const listTasksSchema = {
  name: 'list_tasks',
  description: "List the caller's tasks, optionally filtered by status. Requires an API key.",
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: STATUSES },
      limit: { type: 'number', minimum: 1, maximum: 100 },
      offset: { type: 'number', minimum: 0 },
    },
  },
};

export async function listTasksHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { status, limit, offset } = args;
    if (status !== undefined && !STATUSES.includes(status as string))
      throw new Error(`status must be one of ${STATUSES.join(', ')}`);

    const client = createApiClient(config);
    const tasks = await client.get('/tasks', { status, limit, offset });
    return toolJson(tasks);
  } catch (error) {
    return toolError('list_tasks failed', error);
  }
}
