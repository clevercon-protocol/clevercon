/**
 * settle_task: pay the provider(s) for a delivered hire under your rule. A hire pays
 * on delivery through the buyer's own rule path (private = keyless proof, public =
 * Managed Session), the SAME rails a direct spend uses. Use this after a hire you did
 * not wait on, or to retry a settlement; it settles every step that is RELEASED and
 * not yet paid, and is safe to call repeatedly (paid steps are skipped).
 */
import { settleHireTask } from '../settle.js';
import { toolJson, toolError, type ApiConfig, type ToolResult } from '../api-client.js';

export const settleTaskSchema = {
  name: 'settle_task',
  description:
    'Pay the provider(s) for a delivered hire under your rule (private = keyless ZK proof, public = Managed Session). Settles every step that is RELEASED (delivered + accepted) and not yet paid; safe to call repeatedly. Use after a hire you did not wait on, to retry a settlement, or once a held/long job is accepted. Requires an API key and your configured rule.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The hire task to settle' },
    },
    required: ['taskId'],
  },
};

export async function settleTaskHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const taskId = args.taskId;
    if (typeof taskId !== 'string' || taskId.trim() === '') throw new Error('taskId is required');
    return toolJson(await settleHireTask(config, taskId.trim()));
  } catch (error) {
    return toolError('settle_task failed', error);
  }
}
