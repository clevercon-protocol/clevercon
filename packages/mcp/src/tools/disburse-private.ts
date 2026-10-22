/**
 * disburse_private: the pp/2 TRUSTLESS disburse for agents. Unlike `disburse`
 * (which posts to /payments and lets the server orchestrate a binding release),
 * this proves the owner's PRIVATE policy locally with a Groth16 proof and sends
 * only the proof to the API relay. The server never sees the policy plaintext and
 * cannot forge the proof; the chain verifies it and moves funds. One proof
 * authorizes up to 4 payouts.
 *
 * The private policy is provisioned to the agent out-of-band (never by the model):
 *   - CLEVERCON_POLICY_JSON   inline bundle JSON `{ "rules": {...}, "salt": "..." }`
 *   - CLEVERCON_POLICY_FILE   path to that JSON
 * and the circuit artifacts via CLEVERCON_PP2_WASM / _ZKEY (paths) or _URL (urls).
 */
import { readFileSync } from 'node:fs';
// Import from the light subpaths, NOT the package index: the index pulls in the
// agent/provider/express/x402/mpp chain (~11s cold load) and would make the MCP
// server appear to hang on boot. /prover + /artifacts carry only what we need.
import {
  buildPrivateDisbursement,
  commitmentForBundle,
  DEFAULT_POSEIDON_ARTIFACTS,
  type PolicyBundle,
} from '@clevercon/agent-sdk/prover';
import { resolveArtifacts } from '@clevercon/agent-sdk/artifacts';
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
  const json = process.env.CLEVERCON_POLICY_JSON;
  const file = process.env.CLEVERCON_POLICY_FILE;
  const raw = json ?? (file ? readFileSync(file, 'utf-8') : '');
  if (!raw) {
    throw new Error(
      'no private policy: set CLEVERCON_POLICY_JSON or CLEVERCON_POLICY_FILE to {"rules":{...},"salt":"..."}',
    );
  }
  const bundle = JSON.parse(raw) as PolicyBundle;
  if (!bundle.rules || !bundle.salt) throw new Error('policy bundle needs { rules, salt }');
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
    const { wasmPath, zkeyPath } = await resolveArtifacts();
    const poseidon = resolvePoseidonArtifacts();
    const client = createApiClient(config);

    // Read the vault's per-commitment R2/R7 accumulator so the proof binds to the
    // window state the vault re-derives at settlement (cumulative across tasks).
    const commitment = await commitmentForBundle(bundle, { wasmPath, poseidon });
    const accumulator = await client.get<{
      runningSpend: string;
      priorCount: string;
      anchorR2: string;
      anchorR7: string;
    }>(`/vault/accumulator/${commitment}`);

    // Prove the owner's private policy locally (shared with the SDK spender's
    // disbursePrivate) and relay only the proof. The plaintext policy never leaves
    // this process; the server can neither read nor forge it.
    const { request, totalUsdc, commitmentHex } = await buildPrivateDisbursement(
      bundle,
      lines,
      { wasmPath, zkeyPath, poseidon },
      accumulator,
    );

    const resp = await client.post('/vault/batch-release-proved', request);
    return toolJson({
      submitted: resp,
      legs: lines.length,
      totalUsdc,
      commitment: commitmentHex,
      note: 'Trustless pp/2 release: proof verified on-chain by the vault; funds move once the worker submits it.',
    });
  } catch (error) {
    return toolError('disburse_private failed', error);
  }
}
