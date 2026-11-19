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
import { settleHireTask, type HireTaskDetail } from '../settle.js';

// How long hire_agent waits for a sync hire to deliver before returning with guidance.
const DELIVER_WAIT_MS = Number(process.env.CLEVERCON_HIRE_WAIT_MS ?? 25_000);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const hireAgentSchema = {
  name: 'hire_agent',
  description:
    'Create a task on CleverCon (hire a service). DIRECT pays a chosen serviceId; SEARCH finds and pays one service; COMPOSE runs a multi-service job. ' +
    'If the service lists `functions` (see get_service), pass the chosen function key as functionKey, and shape `input` to THAT function’s input schema. ' +
    'For a DIRECT hire it waits for delivery and then PAYS the provider under your rule (keyless private / Managed Session public), returning the result + settlement; set wait:false to return immediately and settle later with settle_task. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Human-readable task title', maxLength: 200 },
      mode: { type: 'string', enum: ['DIRECT', 'SEARCH', 'COMPOSE'] },
      budget: { type: 'number', description: 'Max spend in USDC', exclusiveMinimum: 0 },
      serviceId: { type: 'string', description: 'Required for DIRECT mode' },
      wait: {
        type: 'boolean',
        description:
          'DIRECT only: wait for delivery and auto-pay the provider under your rule (default true). false returns immediately; settle later with settle_task.',
      },
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
          'Structured job input for the service/function (validated against its input schema). Put required files in input.attachments as an array of ArtifactRef { url, hash, contentType, size }.',
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
    if (
      input !== undefined &&
      (typeof input !== 'object' || input === null || Array.isArray(input))
    )
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
    const task = (await client.post('/tasks', {
      title: title.trim(),
      mode,
      budget,
      ...(serviceId ? { serviceId } : {}),
      ...(functionKey ? { functionKey } : {}),
      policyId: boundPolicyId,
      ...(description ? { description } : {}),
      ...(input ? { input } : {}),
    })) as { id: string };

    // Fire-and-forget on request, or for SEARCH/COMPOSE (no step yet, planned later).
    const wait = args.wait !== false && mode === 'DIRECT';
    if (!wait) {
      return toolJson({
        ...task,
        note: 'Hired. When the step is delivered (RELEASED), call settle_task to pay the provider under your rule.',
      });
    }

    // Wait for delivery, then pay the provider under the rule (the "wire" to payment):
    // a hire pays ONLY after delivery + acceptance, so we never pay up front.
    const taskId = task.id;
    const deadline = Date.now() + DELIVER_WAIT_MS;
    let detail: HireTaskDetail | null = null;
    while (Date.now() < deadline) {
      await delay(1500);
      detail = await client.get<HireTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
      const step = detail.steps?.[0];
      if (detail.status === 'FAILED' || detail.status === 'COMPLETED') break;
      if (
        step &&
        (step.status === 'RELEASED' ||
          step.status === 'AWAITING_APPROVAL' ||
          step.status === 'INPUT_REQUIRED' ||
          step.status === 'FAILED')
      )
        break;
    }

    const step = detail?.steps?.[0];
    if (step && step.status === 'RELEASED' && !step.paid) {
      try {
        const settlement = await settleHireTask(config, taskId);
        const fresh = await client.get<HireTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
        return toolJson({
          task: fresh,
          delivered: true,
          settlement,
          note: 'Hired, delivered, and paid the provider under your rule.',
        });
      } catch (settleErr) {
        return toolJson({
          task: detail,
          delivered: true,
          settled: false,
          settleError: settleErr instanceof Error ? settleErr.message : String(settleErr),
          note: 'Delivered but settlement failed; the provider is unpaid. Retry with settle_task.',
        });
      }
    }

    // Not settleable yet: return the current state + what to do next.
    const st = step?.status ?? detail?.status ?? 'PENDING';
    const guidance =
      st === 'AWAITING_APPROVAL'
        ? 'Held for its dispute window. Call approve_task to accept early, then settle_task.'
        : st === 'INPUT_REQUIRED'
          ? 'The provider asked a question. Answer with answer_step, then poll get_task and settle_task.'
          : detail?.status === 'FAILED' || st === 'FAILED'
            ? 'The job failed, so no payment is due. See the step error for why.'
            : 'Still running. Poll get_task, then call settle_task once the step is RELEASED.';
    return toolJson({
      task: detail ?? task,
      delivered: step?.status === 'RELEASED',
      note: guidance,
    });
  } catch (error) {
    return toolError('hire_agent failed', error);
  }
}
