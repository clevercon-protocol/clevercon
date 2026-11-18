/**
 * Resolve the policy a hire should bind to, the SAME way the dapp binds the rule you
 * pick when you hire: your configured rule, not a throwaway.
 *
 * On the dapp you select a pinned rule and the hire carries its policyId. On MCP/SDK
 * the rule is provisioned out-of-band (never by the model) as an env var created on
 * the Rules tab, so a hire with no explicit policyId resolves to that configured rule:
 *   - CLEVERCON_POLICY_ID   the policyId directly (cheapest, no proving), or
 *   - CLEVERCON_POLICY_KEY  the private rule key (packs { rules, salt }); its commitment
 *     is computed locally and matched to one of your pinned rules to get the policyId.
 *     (legacy CLEVERCON_POLICY_JSON / CLEVERCON_POLICY_FILE still work.)
 *
 * When nothing is configured this returns undefined and the caller fails closed (a hire
 * is blocked rather than running under a throwaway rule). When a private rule IS
 * configured but is not pinned on-chain, it throws with guidance, so a hire never
 * silently runs under the wrong rule.
 */
import { readFileSync } from 'node:fs';
import { unpackPolicyKey } from '@clevercon/agent-sdk/config-tokens';
import type { ApiClient } from './api-client.js';

type Bundle = { rules: unknown; salt: string };

interface PolicyRow {
  id: string;
  commitment: string;
  status: string;
}

// Resolved once per process: the commitment match loads the prover (wasm) and lists
// policies, which we do not want to repeat on every hire.
let cached: string | null | undefined;

/** The configured private rule bundle, or null when none is set. */
function loadBundle(): Bundle | null {
  const token = process.env.CLEVERCON_POLICY_KEY;
  if (token) return unpackPolicyKey(token) as unknown as Bundle;
  const json = process.env.CLEVERCON_POLICY_JSON;
  const file = process.env.CLEVERCON_POLICY_FILE;
  const raw = json ?? (file ? readFileSync(file, 'utf-8') : '');
  if (!raw) return null;
  const bundle = JSON.parse(raw) as Bundle;
  if (!bundle.rules || !bundle.salt) throw new Error('policy bundle needs { rules, salt }');
  return bundle;
}

export async function resolveConfiguredPolicyId(client: ApiClient): Promise<string | undefined> {
  if (cached !== undefined) return cached ?? undefined;

  const explicit = process.env.CLEVERCON_POLICY_ID?.trim();
  if (explicit) {
    cached = explicit;
    return explicit;
  }

  const bundle = loadBundle();
  if (!bundle) {
    cached = null;
    return undefined;
  }

  // Compute the rule's commitment locally (the prover loads only here, lazily, so the
  // hire path stays light when no private rule is configured) and match it to a pinned
  // rule to get its policyId.
  const { commitmentForBundle, DEFAULT_POSEIDON_ARTIFACTS } =
    await import('@clevercon/agent-sdk/prover');
  const { resolveArtifacts } = await import('@clevercon/agent-sdk/artifacts');
  const { wasmPath } = await resolveArtifacts();
  const poseidon = {
    p2: process.env.CLEVERCON_PP2_POSEIDON2 || DEFAULT_POSEIDON_ARTIFACTS.p2,
    p3: process.env.CLEVERCON_PP2_POSEIDON3 || DEFAULT_POSEIDON_ARTIFACTS.p3,
    p4: process.env.CLEVERCON_PP2_POSEIDON4 || DEFAULT_POSEIDON_ARTIFACTS.p4,
  };
  const commitment = (
    await commitmentForBundle(bundle as never, { wasmPath, poseidon })
  ).toLowerCase();

  const { items } = await client.get<{ items: PolicyRow[] }>('/policies');
  const match = items.find(
    (p) => p.commitment?.toLowerCase() === commitment && p.status !== 'archived',
  );
  if (!match) {
    throw new Error(
      'Your configured private rule (CLEVERCON_POLICY_KEY) is not pinned on-chain for this account, so a hire cannot bind to it. Pin it on the Rules tab, then hire again.',
    );
  }
  cached = match.id;
  return match.id;
}

/** Clear the process-level cache. Tests only. */
export function _resetConfiguredPolicyCache(): void {
  cached = undefined;
}
