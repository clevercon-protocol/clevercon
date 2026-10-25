/**
 * Session-key (Fast / public lane) tools for an agent: spend with a bounded
 * session key the owner authorized once, with NO per-payment proof. The on-chain
 * scope - a total spend cap and/or a named public rule (per-payment max/min, rolling
 * cap, velocity, allowlist, deny-list, calendar), plus an optional expiry - is
 * enforced by the vault on every release, so a compromised agent can never exceed
 * the cap, break the rule, or spend past expiry; the owner pauses or revokes
 * instantly.
 *
 * The owner registers + revokes the session elsewhere (dapp / SDK `registerSession`)
 * and provisions the agent out-of-band (never by the model) via env:
 *   CLEVERCON_SESSION_SECRET   the session key's secret (S...)
 *   CLEVERCON_VAULT_ID         the vault contract id (C...)
 *   CLEVERCON_USDC_SAC         the USDC Stellar Asset Contract id (C...)
 *   STELLAR_RPC_URL            optional Soroban RPC (defaults to Stellar testnet)
 *
 * Imported from the light `/sessions` subpath so the MCP server stays quick to boot.
 */
import { createSessionSpender } from '@clevercon/agent-sdk/sessions';
import { toolJson, toolError, type ToolResult } from '../api-client.js';

function loadSpender() {
  const sessionSecret = process.env.CLEVERCON_SESSION_SECRET;
  const vaultId = process.env.CLEVERCON_VAULT_ID;
  const usdcSac = process.env.CLEVERCON_USDC_SAC;
  if (!sessionSecret || !vaultId || !usdcSac) {
    throw new Error(
      'session not provisioned: set CLEVERCON_SESSION_SECRET + CLEVERCON_VAULT_ID + CLEVERCON_USDC_SAC in the MCP server env',
    );
  }
  return createSessionSpender({
    vaultId,
    usdcSac,
    rpcUrl: process.env.STELLAR_RPC_URL,
    sessionSecret,
  });
}

// ── session_pay ───────────────────────────────────────────────────────────────
export const sessionPaySchema = {
  name: 'session_pay',
  description:
    'Pay an address from the vault using your bounded session key (the public "Fast" lane: instant, no per-payment proof). Optionally select a public rule for THIS spend via ruleId (a 32-byte hex id) - the vault enforces that rule (per-payment max/min, rolling cap, velocity, allowlist, deny-list, calendar) on top of the key\'s own cap + expiry; omit it to use the rule the key was registered under, or cap-only. Fails closed if it would exceed the cap, break the rule, or run past expiry. Check what is left with session_scope first. Requires a provisioned session key.',
  inputSchema: {
    type: 'object',
    properties: {
      payee: {
        type: 'string',
        description:
          'Recipient Stellar address (G...); must satisfy the selected rule if one is set',
      },
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in USDC' },
      ruleId: {
        type: 'string',
        description: 'Optional 32-byte hex public rule id to enforce for this spend',
      },
    },
    required: ['payee', 'amount'],
  },
};

export async function sessionPayHandler(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { payee, amount, ruleId } = args;
    if (typeof payee !== 'string' || payee.trim() === '') throw new Error('payee is required');
    if (typeof amount !== 'number' || amount <= 0) throw new Error('amount must be positive');
    if (ruleId !== undefined && (typeof ruleId !== 'string' || !/^[0-9a-fA-F]{64}$/.test(ruleId))) {
      throw new Error('ruleId must be a 32-byte hex string (64 chars)');
    }
    const spender = loadSpender();
    const res = await spender.pay(payee.trim(), amount, ruleId as string | undefined);
    return toolJson({
      sessionPublicKey: spender.publicKey,
      payee: payee.trim(),
      amountUsdc: amount,
      ruleId: ruleId ?? null,
      ...res,
    });
  } catch (error) {
    return toolError('session_pay failed', error);
  }
}

// ── session_scope ───────────────────────────────────────────────────────────
export const sessionScopeSchema = {
  name: 'session_scope',
  description:
    "Read your session key's live on-chain scope: the total spend cap and amount spent/remaining (USDC), the named public rule id it runs under (if any), whether it is paused, its expiry, and how many payments it has made. Use before session_pay to see what is still spendable. Requires a provisioned session key.",
  inputSchema: { type: 'object', properties: {}, required: [] },
};

export async function sessionScopeHandler(): Promise<ToolResult> {
  try {
    const spender = loadSpender();
    const scope = await spender.scope();
    return toolJson({ sessionPublicKey: spender.publicKey, ...scope });
  } catch (error) {
    return toolError('session_scope failed', error);
  }
}
