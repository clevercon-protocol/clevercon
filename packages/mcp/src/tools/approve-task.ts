/**
 * approve_task MCP tool
 *
 * Approves a task's held deliverables early: for a Tier-2 (dispute-window) or
 * Tier-3 (human-approval) hire, this accepts the delivery now and releases
 * payment to the provider instead of waiting for the window (T2) or indefinitely
 * (T3). Requires an API key.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const approveTaskSchema = {
  name: 'approve_task',
  description:
    "Approve a task's held deliverables and release payment to the provider now. " +
    'Use for Tier-2/Tier-3 hires that are awaiting your approval. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The task id' },
    },
    required: ['id'],
  },
};

export async function approveTaskHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { id } = args;
    if (typeof id !== 'string' || id.trim() === '')
      throw new Error('id must be a non-empty string');

    const client = createApiClient(config);
    const result = await client.post(`/tasks/${encodeURIComponent(id.trim())}/approve`);
    return toolJson(result);
  } catch (error) {
    return toolError('approve_task failed', error);
  }
}
