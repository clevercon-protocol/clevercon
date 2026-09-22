/**
 * hire_agent MCP tool
 *
 * Creates a task on CleverCon (hires a service) via the API, authenticated with
 * the caller's API key. This is what lets an agent actually spend on the rail.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const hireAgentSchema = {
  name: 'hire_agent',
  description:
    'Create a task on CleverCon (hire a service). DIRECT pays a chosen serviceId; SEARCH finds and pays one service; COMPOSE runs a multi-service job. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Human-readable task title', maxLength: 200 },
      mode: { type: 'string', enum: ['DIRECT', 'SEARCH', 'COMPOSE'] },
      budget: { type: 'number', description: 'Max spend in USDC', exclusiveMinimum: 0 },
      serviceId: { type: 'string', description: 'Required for DIRECT mode' },
      policyId: { type: 'string', description: 'Spend policy to enforce on-chain' },
      description: { type: 'string', maxLength: 2000 },
    },
    required: ['title', 'mode', 'budget'],
  },
};

export async function hireAgentHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { title, mode, budget, serviceId, policyId, description } = args;
    if (typeof title !== 'string' || title.trim() === '') throw new Error('title is required');
    if (mode !== 'DIRECT' && mode !== 'SEARCH' && mode !== 'COMPOSE')
      throw new Error('mode must be DIRECT, SEARCH, or COMPOSE');
    if (typeof budget !== 'number' || budget <= 0)
      throw new Error('budget must be a positive number');
    if (mode === 'DIRECT' && (typeof serviceId !== 'string' || serviceId === ''))
      throw new Error('serviceId is required for DIRECT mode');

    const client = createApiClient(config);
    const task = await client.post('/tasks', {
      title: title.trim(),
      mode,
      budget,
      ...(serviceId ? { serviceId } : {}),
      ...(policyId ? { policyId } : {}),
      ...(description ? { description } : {}),
    });
    return toolJson(task);
  } catch (error) {
    return toolError('hire_agent failed', error);
  }
}
