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
  policyCommitment,
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

/**
 * The vault's PER-COMMITMENT accumulator state the caller fetched (GET
 * /vault/accumulator/:commitment) before proving. The proof binds to exactly
 * these, and the vault re-derives them at settlement, so a concurrent spend that
 * moved them makes the proof stale (rejected -> refetch + retry). Omit for the
 * first spend under a commitment (defaults to a fresh window).
 */
export interface AccumulatorState {
  runningSpend: string;
  priorCount: string;
  anchorR2: string;
  anchorR7: string;
}

const FRESH_ACCUMULATOR: AccumulatorState = {
  runningSpend: '0',
  priorCount: '0',
  anchorR2: '0',
  anchorR7: '0',
};

/** The proven request plus a little metadata the caller reports back. */
export interface PrivateDisbursement {
  request: BatchReleaseRequest;
  totalUsdc: number;
  /** Canonical policy commitment (hex) the proof carries — the value the owner pins. */
  commitmentHex: string;
}

/**
 * The canonical commitment (hex) for a bundle — the value the owner pinned and the
 * key for the vault's accumulator. Callers compute this to fetch
 * `GET /vault/accumulator/:commitment` BEFORE proving. Only the circuit wasm is
 * needed (no zkey/proof); it shares the download the prover already uses.
 */
export async function commitmentForBundle(
  bundle: PolicyBundle,
  artifacts: { wasmPath: string; poseidon?: PoseidonArtifacts },
): Promise<string> {
  let policy: PolicyWitness;
  if (needsPoseidon(bundle.rules)) {
    const poseidon = await makePoseidon(artifacts.poseidon ?? DEFAULT_POSEIDON_ARTIFACTS);
    ({ policy } = await buildPolicyWitness(bundle, poseidon));
  } else {
    policy = policyWitnessFromBundle(bundle);
  }
  return (await policyCommitment(policy, { wasmPath: artifacts.wasmPath })).toString('hex');
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
  accumulator: AccumulatorState = FRESH_ACCUMULATOR,
  // The GLOBAL-private second proof must cover the SAME validity window as the main
  // release (the vault reconstructs its public signals from the release's
  // validAfter/validBefore). Pass the main proof's window here when building the
  // global proof; omit it for the main proof (it derives its own ~1-day window).
  validity?: { validAfter: string; validBefore: string },
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
    validAfter: validity?.validAfter ?? String(now - 3600),
    validBefore: validity?.validBefore ?? String(now + 86400),
    runningSpend: accumulator.runningSpend,
    priorCount: accumulator.priorCount,
    anchorR2: accumulator.anchorR2,
    anchorR7: accumulator.anchorR7,
  };

  // Distinct spend_counter per leg (ms base + index) so repeated identical releases
  // across calls still derive unique nullifiers.
  const base = Date.now();
  const r = bundle.rules;
  // PRIVACY: a private rule must stay hidden even from the agent running this. So a
  // rejection returns ONE generic reason - never the clause, the limit value, or
  // which axis failed - so the agent learns only "this did not satisfy your rule,
  // nothing was sent", not the rule itself. (A probing agent can still infer bounds
  // by trying amounts; that is inherent and out of our control. We just never hand
  // the rule over directly.) The caller pre-checks locally so we also avoid wasting a
  // proof, but the THROWN message is deliberately opaque.
  const REJECTED =
    'This payment does not satisfy your private rule, so nothing was sent. Adjust the payment (amount or payee) or your rule, then retry.';
  const releases: BatchRelease[] = lines.map((l, i) => {
    if (typeof l.payee !== 'string' || l.payee.trim() === '')
      throw new Error('each line needs a payee address');
    if (typeof l.amount !== 'number' || l.amount <= 0)
      throw new Error('each line needs amount > 0');
    const payee = l.payee.trim();
    // Pre-check the bounds we can know locally so we never waste a proof - but throw
    // the SAME opaque reason for every clause, so the message leaks nothing.
    const entry = r.allowlist?.find((a) => a.payeeAddress === payee);
    const membership = allowlist?.membership(payee);
    if (
      (r.perPaymentCeilingUsdc && l.amount > r.perPaymentCeilingUsdc) ||
      (entry?.perPayeeCapUsdc && l.amount > entry.perPayeeCapUsdc) ||
      (r.denylist?.includes(payee) &&
        (!r.denylistThresholdUsdc || l.amount > r.denylistThresholdUsdc)) ||
      (allowlist && !membership)
    ) {
      throw new Error(REJECTED);
    }
    return {
      payeeAddress: payee,
      amountStroops: String(BigInt(Math.round(l.amount * STROOPS_PER_USDC))),
      spendCounter: String(base + i),
      membership,
    };
  });

  const totalUsdc = releases.reduce(
    (s, r2) => s + Number(BigInt(r2.amountStroops)) / STROOPS_PER_USDC,
    0,
  );
  let proof;
  try {
    proof = await createBatchProof(policy, releases, ctx, {
      wasmPath: artifacts.wasmPath,
      zkeyPath: artifacts.zkeyPath,
    });
  } catch (e) {
    // A circuit assertion (window rules: rolling cap / velocity, caught only at
    // proving time) also collapses to the SAME opaque reason - never the clause.
    const msg = e instanceof Error ? e.message : String(e);
    if (/Assert Failed|template PolicyBatch|line:\s*\d+/i.test(msg)) {
      throw new Error(REJECTED);
    }
    throw e;
  }
  const request = buildBatchReleaseRequest(proof, releases, ctx, {
    vaultTaskId: null,
    planCostUsdc: totalUsdc,
    stepId: base % 1_000_000,
  });
  return { request, totalUsdc, commitmentHex: proof.commitment.toString('hex') };
}
