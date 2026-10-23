/**
 * Session-key (Fast / public lane) tools for an agent: spend with a bounded
 * session key the owner authorized once, with NO per-payment proof. The on-chain
 * scope (spend budget + payee allowlist + hard expiry) is enforced by the vault on
 * every release, so a compromised agent can never pay a non-allowlisted payee,
 * exceed the budget, or spend past expiry; the owner revokes instantly.
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
    'Pay an allowlisted address from the vault using your bounded session key (the public "Fast" lane: instant, no per-payment proof). The on-chain scope the owner authorized - spend budget, payee allowlist, and expiry - is enforced by the vault, so this fails closed if the payee is not allowlisted, the budget is exhausted, or the session has expired. Check remaining budget with session_scope first. Requires a provisioned session key.',
  inputSchema: {
    type: 'object',
    properties: {
      payee: {
        type: 'string',
        description: 'Recipient Stellar address (G...); must be on the session allowlist',
      },
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in USDC' },
    },
    required: ['payee', 'amount'],
  },
};

export async function sessionPayHandler(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { payee, amount } = args;
    if (typeof payee !== 'string' || payee.trim() === '') throw new Error('payee is required');
    if (typeof amount !== 'number' || amount <= 0) throw new Error('amount must be positive');
    const spender = loadSpender();
    const res = await spender.pay(payee.trim(), amount);
    return toolJson({
      sessionPublicKey: spender.publicKey,
      payee: payee.trim(),
      amountUsdc: amount,
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
    "Read your session key's live on-chain scope: remaining spend budget (USDC), the payee allowlist, and the expiry. Use before session_pay to see what is still spendable and to whom. Requires a provisioned session key.",
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
