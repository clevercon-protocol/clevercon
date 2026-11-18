/**
 * Session-key (Fast / public lane) tools for an agent. Public spending runs in one of
 * two modes, chosen by CLEVERCON_PUBLIC_MODE (default `local`):
 *
 *   local  (default) - the AGENT holds its own session key. Provision just:
 *                       CLEVERCON_SESSION_SECRET   (your key's secret - you hold it)
 *                       (the vault + USDC SAC default to the network; CLEVERCON_SESSION_KEY
 *                        token also works and carries them.)
 *   server          - the account's Managed Session (set up in the dapp Vault tab) is
 *                       used via the API. Provision just:
 *                       CLEVERCON_API_KEY          (auth; the bound rule governs)
 *
 * A specific public rule must be set for a public spend (the per-call ruleId, else the
 * one in the session/rule key). The GLOBAL public rule, if any, is enforced by the
 * vault automatically, so the agent never sets it. Both the cap/expiry and the rule
 * are enforced on-chain, so a compromised agent can never exceed them.
 */
import {
  createSessionSpender,
  DEFAULT_TESTNET_VAULT_ID,
  DEFAULT_TESTNET_USDC_SAC,
  type SessionSpender,
} from '@clevercon/agent-sdk/sessions';
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
    if (!sessionSecret) {
      throw new Error(
        'local session not provisioned: set CLEVERCON_SESSION_SECRET (your key secret), or CLEVERCON_SESSION_KEY',
      );
    }
    // The vault + USDC SAC are network constants - default them so the config is just
    // the secret. CLEVERCON_VAULT_ID / CLEVERCON_USDC_SAC override (e.g. mainnet).
    cfg = {
      sessionSecret,
      vaultId: env('CLEVERCON_VAULT_ID') || DEFAULT_TESTNET_VAULT_ID,
      usdcSac: env('CLEVERCON_USDC_SAC') || DEFAULT_TESTNET_USDC_SAC,
      rpcUrl: env('STELLAR_RPC_URL'),
    };
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

    // The rule is OPTIONAL: when the session key was bound to a rule on the dapp
    // (the normal case now), omit it and the vault enforces the bound rule. A per-call
    // ruleId, the session key's packed rule, or CLEVERCON_RULE_KEY can still OVERRIDE it.
    if (publicMode() === 'server') {
      const rule = serverRule(argRule as string | undefined);
      const client = createApiClient(config);
      const res = await client.post('/vault/session/pay', {
        payee: payee.trim(),
        amount,
        ...(rule ? { ruleId: rule } : {}),
      });
      return toolJson({
        mode: 'server',
        payee: payee.trim(),
        amountUsdc: amount,
        ruleId: rule ?? null,
        ...(res as object),
      });
    }

    const { spender, ruleId: tokenRule } = loadLocalSession();
    const rule = (argRule as string | undefined) ?? tokenRule ?? serverRule();
    const res = await spender.pay(payee.trim(), amount, rule);
    return toolJson({
      mode: 'local',
      sessionPublicKey: spender.publicKey,
      payee: payee.trim(),
      amountUsdc: amount,
      ruleId: rule ?? null,
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
