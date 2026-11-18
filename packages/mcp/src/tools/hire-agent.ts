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
import { resolveConfiguredPolicyId } from '../policy-resolve.js';

export const hireAgentSchema = {
  name: 'hire_agent',
  description:
    'Create a task on CleverCon (hire a service). DIRECT pays a chosen serviceId; SEARCH finds and pays one service; COMPOSE runs a multi-service job. ' +
    'If the service lists `functions` (see get_service), pass the chosen function key as functionKey, and shape `input` to THAT function’s input schema. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Human-readable task title', maxLength: 200 },
      mode: { type: 'string', enum: ['DIRECT', 'SEARCH', 'COMPOSE'] },
      budget: { type: 'number', description: 'Max spend in USDC', exclusiveMinimum: 0 },
      serviceId: { type: 'string', description: 'Required for DIRECT mode' },
      functionKey: {
        type: 'string',
        description:
          'For a multi-function service: the key of the function to hire (e.g. "github.search_repos"), from the service’s `functions` list. Omit for single-function services.',
      },
      policyId: {
        type: 'string',
        description:
          'Spend policy to enforce on-chain. Omit to bind your configured rule (CLEVERCON_POLICY_ID, or the CLEVERCON_POLICY_KEY you copied from the Rules tab), exactly like picking a rule in the app. A hire with no rule (passed or configured) is blocked, never run under a throwaway.',
      },
      description: { type: 'string', maxLength: 2000 },
      input: {
        type: 'object',
        description:
          "Structured job input for the service/function (validated against its input schema). Put required files in input.attachments as an array of ArtifactRef { url, hash, contentType, size }.",
      },
    },
    required: ['title', 'mode', 'budget'],
  },
};

export async function hireAgentHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { title, mode, budget, serviceId, functionKey, policyId, description, input } = args;
    if (typeof title !== 'string' || title.trim() === '') throw new Error('title is required');
    if (mode !== 'DIRECT' && mode !== 'SEARCH' && mode !== 'COMPOSE')
      throw new Error('mode must be DIRECT, SEARCH, or COMPOSE');
    if (typeof budget !== 'number' || budget <= 0)
      throw new Error('budget must be a positive number');
    if (mode === 'DIRECT' && (typeof serviceId !== 'string' || serviceId === ''))
      throw new Error('serviceId is required for DIRECT mode');
    if (functionKey !== undefined && typeof functionKey !== 'string')
      throw new Error('functionKey must be a string');
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)))
      throw new Error('input must be an object');

    const client = createApiClient(config);
    // Bind the hire to a policy the SAME way the dapp does: an explicit policyId wins,
    // else your configured rule (CLEVERCON_POLICY_ID / CLEVERCON_POLICY_KEY).
    const boundPolicyId =
      (typeof policyId === 'string' && policyId ? policyId : undefined) ??
      (await resolveConfiguredPolicyId(client));
    // Fail closed: a spend must run under a rule you set, never a throwaway. If no rule
    // is configured (and none was passed), block the hire with guidance, exactly like
    // the dapp refuses to spend with no rule selected.
    if (!boundPolicyId) {
      throw new Error(
        'No spending rule configured, so this hire is blocked. A hire must run under a rule you set. ' +
          'Set CLEVERCON_POLICY_ID to a rule you created in the app (or CLEVERCON_POLICY_KEY for a private rule), then hire again. ' +
          'For public, session-based spending use session_pay instead.',
      );
    }
    const task = await client.post('/tasks', {
      title: title.trim(),
      mode,
      budget,
      ...(serviceId ? { serviceId } : {}),
      ...(functionKey ? { functionKey } : {}),
      policyId: boundPolicyId,
      ...(description ? { description } : {}),
      ...(input ? { input } : {}),
    });
    return toolJson(task);
  } catch (error) {
    return toolError('hire_agent failed', error);
  }
}
