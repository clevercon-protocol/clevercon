/**
 * The money-verb MCP tools: pay, disburse, set_limit, list_limits, get_budget,
 * get_activity. Together with the hire-flow tools they give an agent a full,
 * bounded, non-custodial spending account on CleverCon, driven with an API key
 * exactly as the console does with a session. Every spend is bounded by a policy
 * and released from the vault; the agent never holds funds.
 */

import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

// ── pay ─────────────────────────────────────────────────────────────────────
export const paySchema = {
  name: 'pay',
  description:
    'RETIRED (managed server-path). Use disburse_private for self-custody private spend - your policy is proven locally and only the proof is relayed. Managed/session-key spend returns in a later release.',
  inputSchema: {
    type: 'object',
    properties: {
      payee: { type: 'string', description: 'Recipient Stellar address (G...)' },
      amount: { type: 'number', description: 'Amount in USDC', exclusiveMinimum: 0 },
      reason: { type: 'string', description: 'What this payment is for', maxLength: 500 },
      policyId: { type: 'string', description: 'Optional saved spending limit to enforce' },
    },
    required: ['payee', 'amount'],
  },
};

export async function payHandler(): Promise<ToolResult> {
  return toolError(
    'pay is retired',
    new Error(
      'The managed server-path "pay" is retired: the policy verifier now carries only the ' +
        'pp/2 batch verifying key, so server-built binding proofs no longer verify on-chain. ' +
        'Use "disburse_private" for self-custody private spend. Managed/session-key spend is coming.',
    ),
  );
}

// ── disburse ──────────────────────────────────────────────────────────────────
export const disburseSchema = {
  name: 'disburse',
  description:
    'RETIRED (managed server-path). Use disburse_private to disburse to many addresses with your policy proven locally and only the proof relayed. Managed/session-key spend returns in a later release.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'Recipients to pay',
        items: {
          type: 'object',
          properties: {
            payee: { type: 'string', description: 'Recipient Stellar address (G...)' },
            amount: { type: 'number', exclusiveMinimum: 0 },
            reason: { type: 'string', maxLength: 500 },
          },
          required: ['payee', 'amount'],
        },
        minItems: 1,
        maxItems: 100,
      },
      policyId: { type: 'string', description: 'Optional saved spending limit to enforce' },
    },
    required: ['lines'],
  },
};

export async function disburseHandler(): Promise<ToolResult> {
  return toolError(
    'disburse is retired',
    new Error(
      'The managed server-path "disburse" is retired: the policy verifier now carries only ' +
        'the pp/2 batch verifying key, so server-built binding proofs no longer verify on-chain. ' +
        'Use "disburse_private" for self-custody private spend. Managed/session-key spend is coming.',
    ),
  );
}

// ── set_limit ─────────────────────────────────────────────────────────────────
export const setLimitSchema = {
  name: 'set_limit',
  description:
    'Create a reusable spending limit (policy): a per-payment cap, a rolling cap over a window, and/or an allowlist of payees. Enforced on every spend; kept private if isPrivate. Returns the policyId to pass to pay/disburse/hire. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      perPaymentCeilingUsdc: { type: 'number', exclusiveMinimum: 0 },
      rollingCapUsdc: { type: 'number', exclusiveMinimum: 0 },
      rollingWindowSecs: { type: 'number', description: 'Window for the rolling cap (e.g. 86400)' },
      allowlist: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only these Stellar addresses may be paid',
      },
      isPrivate: { type: 'boolean', description: 'Store only a commitment, not the rule' },
    },
  },
};

export async function setLimitHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { perPaymentCeilingUsdc, rollingCapUsdc, rollingWindowSecs, allowlist, isPrivate } = args;
    const rules: Record<string, unknown> = {};
    if (typeof perPaymentCeilingUsdc === 'number')
      rules.perPaymentCeilingUsdc = perPaymentCeilingUsdc;
    if (typeof rollingCapUsdc === 'number') rules.rollingCapUsdc = rollingCapUsdc;
    if (typeof rollingWindowSecs === 'number') rules.rollingWindowSecs = rollingWindowSecs;
    if (Array.isArray(allowlist) && allowlist.length) rules.allowlist = allowlist;
    if (Object.keys(rules).length === 0) throw new Error('at least one rule is required');
    const client = createApiClient(config);
    const policy = await client.post('/policies', { rules, isPrivate: isPrivate === true });
    return toolJson(policy);
  } catch (error) {
    return toolError('set_limit failed', error);
  }
}

// ── list_limits ───────────────────────────────────────────────────────────────
export const listLimitsSchema = {
  name: 'list_limits',
  description: 'List saved spending limits (policies) for the caller. Requires an API key.',
  inputSchema: { type: 'object', properties: {} },
};

export async function listLimitsHandler(
  _args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const client = createApiClient(config);
    return toolJson(await client.get('/policies'));
  } catch (error) {
    return toolError('list_limits failed', error);
  }
}

// ── get_budget ────────────────────────────────────────────────────────────────
export const getBudgetSchema = {
  name: 'get_budget',
  description:
    'Get the vault position the agent can spend: balance, available (balance minus locked), and locked. Requires an API key.',
  inputSchema: { type: 'object', properties: {} },
};

export async function getBudgetHandler(
  _args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const client = createApiClient(config);
    return toolJson(await client.get('/vault'));
  } catch (error) {
    return toolError('get_budget failed', error);
  }
}

// ── get_activity ──────────────────────────────────────────────────────────────
export const getActivitySchema = {
  name: 'get_activity',
  description:
    'Get the recent activity ledger (jobs and payments), newest first. Requires an API key.',
  inputSchema: { type: 'object', properties: {} },
};

export async function getActivityHandler(
  _args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const client = createApiClient(config);
    return toolJson(await client.get('/activity'));
  } catch (error) {
    return toolError('get_activity failed', error);
  }
}
