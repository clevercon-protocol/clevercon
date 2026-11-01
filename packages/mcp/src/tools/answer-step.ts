/**
 * answer_step MCP tool
 *
 * Answers a step a provider parked as INPUT_REQUIRED mid-job (an elicitation), so
 * a long-running hire can resume. Read the pending question with get_task (the
 * step carries status INPUT_REQUIRED and an inputRequest { requestId, prompt,
 * schema? }); the response is validated against that schema server-side before it
 * is relayed to the provider. Requires an API key.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const answerStepSchema = {
  name: 'answer_step',
  description:
    'Answer a step that is awaiting input (status INPUT_REQUIRED) so the job resumes. ' +
    'Read the question first with get_task (step.inputRequest). The response object is ' +
    "validated against the question's schema. Requires an API key.",
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The task id' },
      stepId: { type: 'string', description: 'The step id awaiting input (from get_task)' },
      response: {
        type: 'object',
        description: "The answer payload (must satisfy the question's schema, if any)",
      },
    },
    required: ['taskId', 'stepId', 'response'],
  },
};

export async function answerStepHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { taskId, stepId, response } = args;
    if (typeof taskId !== 'string' || taskId.trim() === '')
      throw new Error('taskId must be a non-empty string');
    if (typeof stepId !== 'string' || stepId.trim() === '')
      throw new Error('stepId must be a non-empty string');
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new Error('response must be an object');

    const client = createApiClient(config);
    const result = await client.post(
      `/tasks/${encodeURIComponent(taskId.trim())}/steps/${encodeURIComponent(stepId.trim())}/answer`,
      { response },
    );
    return toolJson(result);
  } catch (error) {
    return toolError('answer_step failed', error);
  }
}
