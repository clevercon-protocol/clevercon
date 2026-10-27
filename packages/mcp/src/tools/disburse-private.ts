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
 * Circuit artifacts download automatically from the hosted bucket on first use (no
 * setup); CLEVERCON_PP2_WASM / _ZKEY (paths) or _URL only override them.
 */
import { readFileSync } from 'node:fs';
// Import from the light subpaths, NOT the package index: the index pulls in the
// agent/provider/express/x402/mpp chain (~11s cold load) and would make the MCP
// server appear to hang on boot. /prover + /artifacts + /config-tokens carry only
// what we need.
import {
  buildPrivateDisbursement,
  commitmentForBundle,
  DEFAULT_POSEIDON_ARTIFACTS,
  type PolicyBundle,
} from '@clevercon/agent-sdk/prover';
import { resolveArtifacts } from '@clevercon/agent-sdk/artifacts';
import { unpackPolicyKey } from '@clevercon/agent-sdk/config-tokens';
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
    'Trustlessly disburse USDC to up to 4 addresses under your PRIVATE policy, proven on-chain with zero-knowledge (the server never sees the policy, only the proof). Enforces every rule the provisioned policy carries: per-payment ceiling, rolling cap, approved-payee allowlist (with optional per-payee cap + category), deny-list, calendar windows, velocity, and category ceilings. Use when the policy must stay private and enforcement must be trustless. Requires the owner to have provisioned a policy bundle + proving artifacts to this agent. Requires an API key.',
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

function loadPolicyBundle(): PolicyBundle {
  const token = process.env.CLEVERCON_POLICY_KEY;
  if (token) return unpackPolicyKey(token) as unknown as PolicyBundle;
  const json = process.env.CLEVERCON_POLICY_JSON;
  const file = process.env.CLEVERCON_POLICY_FILE;
  const raw = json ?? (file ? readFileSync(file, 'utf-8') : '');
  if (!raw) {
    throw new Error(
      'no private policy: set CLEVERCON_POLICY_KEY to the key you copied from the Rules tab',
    );
  }
  const bundle = JSON.parse(raw) as PolicyBundle;
  if (!bundle.rules || !bundle.salt) throw new Error('policy bundle needs { rules, salt }');
  return bundle;
}

/** The owner's global-private bundle, if a global rule is set on-chain (else null). */
function loadGlobalBundle(): PolicyBundle | null {
  const token = process.env.CLEVERCON_GLOBAL_KEY;
  if (token) return unpackPolicyKey(token) as unknown as PolicyBundle;
  const json = process.env.CLEVERCON_GLOBAL_POLICY_JSON;
  const file = process.env.CLEVERCON_GLOBAL_POLICY_FILE;
  const raw = json ?? (file ? readFileSync(file, 'utf-8') : '');
  if (!raw) return null;
  const bundle = JSON.parse(raw) as PolicyBundle;
  if (!bundle.rules || !bundle.salt) throw new Error('global bundle needs { rules, salt }');
  return bundle;
}

/**
 * Where to fetch the poseidon2/3/4 wasm for allowlist/calendar proving. Defaults
 * to the hosted artifacts; override each with an env path or URL when running
 * against a custom host or a local build.
 */
function resolvePoseidonArtifacts() {
  return {
    p2: process.env.CLEVERCON_PP2_POSEIDON2 || DEFAULT_POSEIDON_ARTIFACTS.p2,
    p3: process.env.CLEVERCON_PP2_POSEIDON3 || DEFAULT_POSEIDON_ARTIFACTS.p3,
    p4: process.env.CLEVERCON_PP2_POSEIDON4 || DEFAULT_POSEIDON_ARTIFACTS.p4,
  };
}

export async function disbursePrivateHandler(
  args: Record<string, unknown>,
  config: ApiConfig,
): Promise<ToolResult> {
  try {
    const lines = args.lines;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 4) {
      throw new Error('lines must be an array of 1..4 {payee, amount}');
    }

    const bundle = loadPolicyBundle();
    const globalBundle = loadGlobalBundle();
    const { wasmPath, zkeyPath } = await resolveArtifacts();
    const poseidon = resolvePoseidonArtifacts();
    const client = createApiClient(config);
    type Accum = {
      runningSpend: string;
      priorCount: string;
      anchorR2: string;
      anchorR7: string;
    };
    const readAccum = (c: string) => client.get<Accum>(`/vault/accumulator/${c}`);
    const art = { wasmPath, zkeyPath, poseidon };

    // Read the vault's per-commitment R2/R7 accumulator so the proof binds to the
    // window state the vault re-derives at settlement (cumulative across tasks).
    const commitment = await commitmentForBundle(bundle, { wasmPath, poseidon });

    // Prove the owner's private policy locally (shared with the SDK spender's
    // disbursePrivate) and relay only the proof. The plaintext policy never leaves
    // this process; the server can neither read nor forge it.
    const { request, totalUsdc, commitmentHex } = await buildPrivateDisbursement(
      bundle,
      lines,
      art,
      await readAccum(commitment),
    );

    // When a global-private rule is set, the vault needs a SECOND proof over the same
    // payees/amounts against the global commitment (its own window + nullifiers).
    let global:
      | {
          commitment: string;
          nullifiers: string[];
          resetR2: boolean;
          resetR7: boolean;
          proof: { a: string; b: string; c: string };
        }
      | undefined;
    if (globalBundle) {
      const gCommitment = await commitmentForBundle(globalBundle, { wasmPath, poseidon });
      const g = await buildPrivateDisbursement(
        globalBundle,
        lines,
        art,
        await readAccum(gCommitment),
      );
      global = {
        commitment: g.request.commitment,
        nullifiers: g.request.nullifiers,
        resetR2: g.request.resetR2,
        resetR7: g.request.resetR7,
        proof: g.request.proof,
      };
    }

    const resp = await client.post('/vault/batch-release-keyless', {
      ...request,
      ...(global ? { global } : {}),
    });
    return toolJson({
      submitted: resp,
      legs: lines.length,
      totalUsdc,
      commitment: commitmentHex,
      globalProof: !!global,
      note: 'Trustless pp/2 KEYLESS release: proof verified on-chain by the vault; funds move immediately (returns the tx hash).',
    });
  } catch (error) {
    return toolError('disburse_private failed', error);
  }
}
