/**
 * disburse_private: the pp/2 TRUSTLESS, KEYLESS disburse for agents. This proves the
 * owner's PRIVATE policy locally with a Groth16 proof and sends only the proof to the
 * API relay, which submits release_proved_keyless: the vault takes no signature - the
 * proof + the owner's pinned commitment + a fresh nullifier authorize it - so there
 * is no delegate and no per-payment key, only a fee-payer relayer. The server never
 * sees the policy plaintext and cannot forge the proof; the chain verifies it and
 * moves funds. One proof authorizes up to 4 payouts.
 *
 * The private policy is provisioned to the agent out-of-band (never by the model) as
 * ONE opaque key copied from the dapp Rules tab:
 *   - CLEVERCON_POLICY_KEY    the policy key token (packs { rules, salt })
 *   (legacy: CLEVERCON_POLICY_JSON / CLEVERCON_POLICY_FILE still work.)
 * When a global-private rule is set on-chain, add the global key too (its "global
 * salt"), so the required second proof is relayed:
 *   - CLEVERCON_GLOBAL_KEY    (legacy: CLEVERCON_GLOBAL_POLICY_JSON / _FILE.)
 *
 * KEYLESS, so the DEFAULT path needs no local wasm/zkey (the vault verifies the proof
 * on-chain). The poseidon/circuit artifacts download automatically from the hosted
 * bucket when a rule needs them (allowlist / deny / calendar / category); set
 * CLEVERCON_PP2_WASM / _ZKEY / _POSEIDON* only to pin local files.
 */
import { relayKeylessDisbursement } from '../keyless-relay.js';
import {
  createApiClient,
  toolJson,
  toolError,
  type ApiConfig,
  type ToolResult,
} from '../api-client.js';

export const disbursePrivateSchema = {
  name: 'disburse_private',
  description:
    'Trustlessly disburse USDC to up to 4 addresses under your PRIVATE policy, proven on-chain with zero-knowledge (the server never sees the policy, only the proof). Enforces every rule the provisioned policy carries: per-payment ceiling, rolling cap, approved-payee allowlist (with optional per-payee cap + category), deny-list, calendar windows, velocity, and category ceilings. Use when the policy must stay private and enforcement must be trustless. Requires the owner to have provisioned a policy bundle (CLEVERCON_POLICY_KEY) to this agent. Requires an API key.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'Up to 4 recipients to pay in one proof',
        items: {
          type: 'object',
          properties: {
            payee: { type: 'string', description: 'Recipient Stellar address (G...)' },
            amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in USDC' },
          },
          required: ['payee', 'amount'],
        },
        minItems: 1,
        maxItems: 4,
      },
    },
    required: ['lines'],
  },
};

export async function disbursePrivateHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const raw = args.lines;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) {
      throw new Error('lines must be an array of 1..4 {payee, amount}');
    }
    const lines = raw.map((l) => {
      const o = l as { payee?: unknown; amount?: unknown };
      return { payee: String(o.payee ?? ''), amount: Number(o.amount) };
    });
    const client = createApiClient(config);
    const res = await relayKeylessDisbursement(client, lines);
    return toolJson({
      submitted: res.submitted,
      legs: res.legs,
      totalUsdc: res.totalUsdc,
      commitment: res.commitment,
      globalProof: res.globalProof,
      note: 'Trustless pp/2 KEYLESS release: proof verified on-chain by the vault; funds move immediately (returns the tx hash).',
    });
  } catch (error) {
    return toolError('disburse_private failed', error);
  }
}
