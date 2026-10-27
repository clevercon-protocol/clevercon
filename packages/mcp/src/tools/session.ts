/**
 * Session-key (Fast / public lane) tools for an agent. Public spending runs in one of
 * two modes, chosen by CLEVERCON_PUBLIC_MODE (default `local`):
 *
 *   local  (default) - the AGENT holds its own session key. Provision ONE token:
 *                       CLEVERCON_SESSION_KEY   (from the SDK `registerSession`; packs
 *                                                the key + vault/USDC ids + rule)
 *                       (legacy: CLEVERCON_SESSION_SECRET + CLEVERCON_VAULT_ID +
 *                        CLEVERCON_USDC_SAC still work.)
 *   server          - the account's Managed Session (set up in the dapp Vault tab) is
 *                       used via the API. Provision:
 *                       CLEVERCON_API_KEY       (auth)
 *                       CLEVERCON_RULE_KEY      (the public rule to spend under)
 *
 * A specific public rule must be set for a public spend (the per-call ruleId, else the
 * one in the session/rule key). The GLOBAL public rule, if any, is enforced by the
 * vault automatically, so the agent never sets it. Both the cap/expiry and the rule
 * are enforced on-chain, so a compromised agent can never exceed them.
 */
import { createSessionSpender, type SessionSpender } from '@clevercon/agent-sdk/sessions';
import { unpackSessionKey, unpackRuleKey } from '@clevercon/agent-sdk/config-tokens';
import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

const env = (k: string): string | undefined => process.env[k] || undefined;
const isRuleId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);

function publicMode(): 'local' | 'server' {
  return (env('CLEVERCON_PUBLIC_MODE') || 'local').toLowerCase() === 'server' ? 'server' : 'local';
}

/** The local session spender + the rule packed in its key, from the token (or legacy env). */
function loadLocalSession(): { spender: SessionSpender; ruleId?: string } {
  const token = env('CLEVERCON_SESSION_KEY');
  let cfg: {
    sessionSecret: string;
    vaultId: string;
    usdcSac: string;
    rpcUrl?: string;
    ruleId?: string;
  };
  if (token) {
    cfg = unpackSessionKey(token);
  } else {
    const sessionSecret = env('CLEVERCON_SESSION_SECRET');
    const vaultId = env('CLEVERCON_VAULT_ID');
    const usdcSac = env('CLEVERCON_USDC_SAC');
    if (!sessionSecret || !vaultId || !usdcSac) {
      throw new Error(
        'local session not provisioned: set CLEVERCON_SESSION_KEY (from the SDK registerSession), or CLEVERCON_SESSION_SECRET + CLEVERCON_VAULT_ID + CLEVERCON_USDC_SAC',
      );
    }
    cfg = { sessionSecret, vaultId, usdcSac, rpcUrl: env('STELLAR_RPC_URL') };
  }
  const spender = createSessionSpender({
    vaultId: cfg.vaultId,
    usdcSac: cfg.usdcSac,
    rpcUrl: cfg.rpcUrl,
    sessionSecret: cfg.sessionSecret,
  });
  return { spender, ruleId: cfg.ruleId };
}

/** The public rule to enforce (server mode): a per-call ruleId, else CLEVERCON_RULE_KEY. */
function serverRule(argRule?: string): string | undefined {
  if (argRule) return argRule;
  const rk = env('CLEVERCON_RULE_KEY');
  return rk ? unpackRuleKey(rk) : undefined;
}

// ── session_pay ───────────────────────────────────────────────────────────────
export const sessionPaySchema = {
  name: 'session_pay',
  description:
    'Pay an address from the vault on the public "Fast" lane (instant, no per-payment proof). Runs in local mode (the agent holds its own session key) or server mode (the account\'s Managed Session via the API), set by CLEVERCON_PUBLIC_MODE. A specific public rule is enforced for the spend - the per-call ruleId, else the one in your session/rule key - on top of the key\'s own cap + expiry (and the global public rule, which the vault applies automatically). Fails closed if it would exceed the cap, break the rule, or run past expiry.',
  inputSchema: {
    type: 'object',
    properties: {
      payee: { type: 'string', description: 'Recipient Stellar address (G...)' },
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in USDC' },
      ruleId: {
        type: 'string',
        description:
          'Optional 32-byte hex public rule id to enforce for this spend (overrides the configured rule)',
      },
    },
    required: ['payee', 'amount'],
  },
};

export async function sessionPayHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const { payee, amount, ruleId: argRule } = args;
    if (typeof payee !== 'string' || payee.trim() === '') throw new Error('payee is required');
    if (typeof amount !== 'number' || amount <= 0) throw new Error('amount must be positive');
    if (argRule !== undefined && !isRuleId(argRule)) {
      throw new Error('ruleId must be a 32-byte hex string (64 chars)');
    }

    if (publicMode() === 'server') {
      const rule = serverRule(argRule as string | undefined);
      if (!rule) {
        throw new Error(
          'a public rule must be set for the spend: provide CLEVERCON_RULE_KEY (from the Rules tab) or pass ruleId',
        );
      }
      const client = createApiClient(config);
      const res = await client.post('/vault/session/pay', {
        payee: payee.trim(),
        amount,
        ruleId: rule,
      });
      return toolJson({
        mode: 'server',
        payee: payee.trim(),
        amountUsdc: amount,
        ruleId: rule,
        ...(res as object),
      });
    }

    const { spender, ruleId: tokenRule } = loadLocalSession();
    // The rule for a local spend: a per-call ruleId, else the one packed in the
    // session key, else CLEVERCON_RULE_KEY (set it when the session key is a bare
    // secret + vault/USDC without a rule, e.g. a key authorized on the dapp).
    const rule = (argRule as string | undefined) ?? tokenRule ?? serverRule();
    if (!rule) {
      throw new Error(
        'a public rule must be set for the spend: set CLEVERCON_RULE_KEY (from the Rules tab), register the key under a rule, or pass ruleId',
      );
    }
    const res = await spender.pay(payee.trim(), amount, rule);
    return toolJson({
      mode: 'local',
      sessionPublicKey: spender.publicKey,
      payee: payee.trim(),
      amountUsdc: amount,
      ruleId: rule,
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
    "Read your session's live on-chain scope: the total spend cap and amount spent/remaining (USDC), the public rule id it runs under (if any), whether it is paused, its expiry, and how many payments it has made. Works in local mode (your session key) or server mode (the account's Managed Session). Use before session_pay to see what is still spendable.",
  inputSchema: { type: 'object', properties: {}, required: [] },
};

export async function sessionScopeHandler(config: ApiConfig): Promise<ToolResult> {
  try {
    if (publicMode() === 'server') {
      const client = createApiClient(config);
      const s = await client.get('/vault/session');
      return toolJson({ mode: 'server', ...(s as object) });
    }
    const { spender } = loadLocalSession();
    const scope = await spender.scope();
    return toolJson({ mode: 'local', sessionPublicKey: spender.publicKey, ...scope });
  } catch (error) {
    return toolError('session_scope failed', error);
  }
}
