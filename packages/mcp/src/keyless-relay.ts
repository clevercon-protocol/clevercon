/**
 * The shared pp/2 KEYLESS relay: prove the owner's private rule LOCALLY and relay
 * only the proof to the vault, which verifies it on-chain and moves funds with no
 * delegate and no per-payment key. This is the exact path `disburse_private` uses;
 * a hire settlement is the SAME release, just paying the provider's address and
 * carrying `hire` meta so the server links the on-chain release to the task step.
 *
 * Kept dependency-light at import time: the prover (snarkjs/stellar) loads lazily
 * via the agent-sdk subpaths, so importing this module does not pull it in.
 */
import { readFileSync } from 'node:fs';
import {
  buildPrivateDisbursement,
  commitmentForBundle,
  DEFAULT_POSEIDON_ARTIFACTS,
  type PolicyBundle,
} from '@clevercon/agent-sdk/prover';
import { resolveArtifacts } from '@clevercon/agent-sdk/artifacts';
import { unpackPolicyKey } from '@clevercon/agent-sdk/config-tokens';
import type { ApiClient } from './api-client.js';

export interface KeylessLine {
  payee: string;
  amount: number;
}

/** True when a private rule is provisioned to this agent (any supported form). */
export function hasPrivatePolicy(): boolean {
  return !!(
    process.env.CLEVERCON_POLICY_KEY ||
    process.env.CLEVERCON_POLICY_JSON ||
    process.env.CLEVERCON_POLICY_FILE
  );
}

/** The configured private rule bundle (ccpk1_ token, or legacy raw/file JSON). */
export function loadPolicyBundle(): PolicyBundle {
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
export function loadGlobalBundle(): PolicyBundle | null {
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

function resolvePoseidonArtifacts() {
  return {
    p2: process.env.CLEVERCON_PP2_POSEIDON2 || DEFAULT_POSEIDON_ARTIFACTS.p2,
    p3: process.env.CLEVERCON_PP2_POSEIDON3 || DEFAULT_POSEIDON_ARTIFACTS.p3,
    p4: process.env.CLEVERCON_PP2_POSEIDON4 || DEFAULT_POSEIDON_ARTIFACTS.p4,
  };
}

/** A rule configured but not pinned on-chain: a typed, actionable failure. */
export class RuleNotPinnedError extends Error {
  constructor() {
    super(
      'This rule is not pinned on-chain for your account, so it cannot authorize a spend. Pin it on the Rules tab, then try again.',
    );
    this.name = 'RuleNotPinnedError';
  }
}

export interface KeylessResult {
  submitted: unknown;
  legs: number;
  totalUsdc: number;
  commitment: string;
  globalProof: boolean;
}

/**
 * Prove the owner's private rule over `lines` (1..4 payees) and relay the keyless
 * release. When `hire` is given, the server records a step-linked VAULT_RELEASE
 * payment after the on-chain release, so a hired provider is marked paid.
 */
export async function relayKeylessDisbursement(
  client: ApiClient,
  lines: KeylessLine[],
  hire?: { taskId: string; stepIds: (string | null)[] },
): Promise<KeylessResult> {
  if (lines.length === 0 || lines.length > 4) {
    throw new Error('keyless release takes 1..4 {payee, amount} per proof');
  }
  const bundle = loadPolicyBundle();
  const globalBundle = loadGlobalBundle();
  const { wasmPath, zkeyPath } = await resolveArtifacts();
  const poseidon = resolvePoseidonArtifacts();
  type Accum = { runningSpend: string; priorCount: string; anchorR2: string; anchorR7: string };
  const readAccum = (c: string) => client.get<Accum>(`/vault/accumulator/${c}`);
  const art = { wasmPath, zkeyPath, poseidon };

  const commitment = await commitmentForBundle(bundle, { wasmPath, poseidon });

  // Fail fast if the rule is not pinned, BEFORE the expensive proof. A read failure
  // does not block (the vault stays the authoritative check).
  try {
    const { commitments } = await client.get<{ commitments: string[] }>(
      '/vault/pinned-commitments',
    );
    if (!commitments.map((c) => c.toLowerCase()).includes(commitment.toLowerCase())) {
      throw new RuleNotPinnedError();
    }
  } catch (err) {
    if (err instanceof RuleNotPinnedError) throw err;
    // network/read error: proceed and let the vault be authoritative
  }

  const { request, totalUsdc, commitmentHex } = await buildPrivateDisbursement(
    bundle,
    lines,
    art,
    await readAccum(commitment),
  );

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
      {
        validAfter: request.validAfter,
        validBefore: request.validBefore,
      },
    );
    global = {
      commitment: g.request.commitment,
      nullifiers: g.request.nullifiers,
      resetR2: g.request.resetR2,
      resetR7: g.request.resetR7,
      proof: g.request.proof,
    };
  }

  const submitted = await client.post('/vault/batch-release-keyless', {
    ...request,
    ...(global ? { global } : {}),
    ...(hire ? { hire } : {}),
  });
  return {
    submitted,
    legs: lines.length,
    totalUsdc,
    commitment: commitmentHex,
    globalProof: !!global,
  };
}
