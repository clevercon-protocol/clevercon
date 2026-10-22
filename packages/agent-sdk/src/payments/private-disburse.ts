/**
 * Shared self-custody PRIVATE disbursement: prove an owner's private policy bundle
 * LOCALLY (Groth16) and return the exact request the vault's
 * `/vault/batch-release-proved` relay accepts. The plaintext policy never leaves
 * the caller; only the proof is produced here. Used by BOTH the SDK spender
 * (`disbursePrivate`) and the MCP `disburse_private` tool so the two prove
 * identically — one place to keep the witness build, nullifier derivation, and
 * request shape correct.
 */
import {
  createBatchProof,
  buildBatchReleaseRequest,
  type BatchRelease,
  type BatchContext,
  type BatchReleaseRequest,
  type PolicyWitness,
} from './batch-prover.js';
import { policyWitnessFromBundle, buildPolicyWitness, type PolicyBundle } from './policy-bundle.js';
import { makePoseidon, type PoseidonArtifacts } from './poseidon.js';
import { DEFAULT_POSEIDON_ARTIFACTS } from './artifacts-base.js';
import type { Allowlist } from './allowlist.js';

const STROOPS_PER_USDC = 10_000_000;

/** One recipient of a private disbursement. */
export interface DisbursementLine {
  payee: string;
  amount: number;
}

/** Circuit artifacts for local proving. `poseidon` is only needed when the policy
 *  carries an allowlist/deny/calendar/category rule; it defaults to the hosted set. */
export interface PrivateDisburseArtifacts {
  wasmPath: string;
  zkeyPath: string;
  poseidon?: PoseidonArtifacts;
}

/** The proven request plus a little metadata the caller reports back. */
export interface PrivateDisbursement {
  request: BatchReleaseRequest;
  totalUsdc: number;
  /** Canonical policy commitment (hex) the proof carries — the value the owner pins. */
  commitmentHex: string;
}

/** A bare per-payment ceiling (+ rolling/velocity) is field-only; an allowlist,
 *  deny-list, calendar, or category rule needs the Poseidon oracle for its roots. */
function needsPoseidon(rules: PolicyBundle['rules']): boolean {
  return !!(
    rules.allowlist?.length ||
    rules.denylist?.length ||
    rules.calendarWindows?.length ||
    rules.categoryCeilingsUsdc?.length
  );
}

/**
 * Prove a 1..4-recipient batch under the owner's private {@link PolicyBundle} and
 * build the relay request. Enforces every rule the bundle carries: a payee off the
 * committed allowlist fails here, before any proof is wasted. The release's
 * validity window is ~1 day, well inside the vault's cap.
 */
export async function buildPrivateDisbursement(
  bundle: PolicyBundle,
  lines: DisbursementLine[],
  artifacts: PrivateDisburseArtifacts,
): Promise<PrivateDisbursement> {
  if (!bundle?.rules || !bundle?.salt) throw new Error('policy bundle needs { rules, salt }');
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 4) {
    throw new Error('disbursement must have 1..4 {payee, amount} lines');
  }

  let policy: PolicyWitness;
  let allowlist: Allowlist | undefined;
  if (needsPoseidon(bundle.rules)) {
    const poseidon = await makePoseidon(artifacts.poseidon ?? DEFAULT_POSEIDON_ARTIFACTS);
    ({ policy, allowlist } = await buildPolicyWitness(bundle, poseidon));
  } else {
    policy = policyWitnessFromBundle(bundle);
  }

  const now = Math.floor(Date.now() / 1000);
  const ctx: BatchContext = {
    validAfter: String(now - 3600),
    validBefore: String(now + 86400),
    runningSpend: '0',
    priorCount: '0',
  };

  // Distinct spend_counter per leg (ms base + index) so repeated identical releases
  // across calls still derive unique nullifiers.
  const base = Date.now();
  const releases: BatchRelease[] = lines.map((l, i) => {
    if (typeof l.payee !== 'string' || l.payee.trim() === '')
      throw new Error('each line needs a payee address');
    if (typeof l.amount !== 'number' || l.amount <= 0)
      throw new Error('each line needs amount > 0');
    const payee = l.payee.trim();
    const membership = allowlist?.membership(payee);
    if (allowlist && !membership)
      throw new Error(`payee ${payee} is not on the policy allowlist (R3)`);
    return {
      payeeAddress: payee,
      amountStroops: String(BigInt(Math.round(l.amount * STROOPS_PER_USDC))),
      spendCounter: String(base + i),
      membership,
    };
  });

  const totalUsdc = releases.reduce(
    (s, r) => s + Number(BigInt(r.amountStroops)) / STROOPS_PER_USDC,
    0,
  );
  const proof = await createBatchProof(policy, releases, ctx, {
    wasmPath: artifacts.wasmPath,
    zkeyPath: artifacts.zkeyPath,
  });
  const request = buildBatchReleaseRequest(proof, releases, ctx, {
    vaultTaskId: null,
    planCostUsdc: totalUsdc,
    stepId: base % 1_000_000,
  });
  return { request, totalUsdc, commitmentHex: proof.commitment.toString('hex') };
}
