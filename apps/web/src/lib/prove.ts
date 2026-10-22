import { apiGet, apiPost } from './api';
import {
  createBatchProof,
  policyCommitment,
  policyWitnessFromBundle,
  buildPolicyWitness,
  makePoseidon,
  newSalt,
  buildBatchReleaseRequest,
  DEFAULT_ARTIFACT_BASE_URL,
  DEFAULT_POSEIDON_ARTIFACTS,
  type BatchRelease,
  type BatchContext,
  type Allowlist,
  type PolicyWitness,
  type PolicyBundleRules,
} from '@clevercon/agent-sdk/prover';

const STROOPS = 10_000_000;
const WASM = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch.wasm`;
const ZKEY = `${DEFAULT_ARTIFACT_BASE_URL}/policy_batch_final.zkey`;

/** One Groth16 proof authorizes up to this many payouts (circuit N=4). */
export const PROOF_WIDTH = 4;
/** UI soft cap on recipients; longer lists auto-split into proofs of four. */
export const MAX_RECIPIENTS = 100;

export type ProvePhase = 'proving' | 'relaying' | 'done';
export interface ProveRecipient {
  payee: string;
  amount: number;
}
export interface ProveResult {
  jobIds: string[];
  total: number;
  legs: number;
  batches: number;
}

/**
 * Prove a private spending policy IN THE BROWSER and relay the proof for an
 * on-chain, vault-gated release. This is the single pp/2 path shared by the
 * Disburse page and the Agent tab: the owner's rule becomes a Groth16 proof here
 * (never transmitted), the server only relays it, and the chain verifies it
 * before the bounded delegate moves funds. A proof covers up to {@link PROOF_WIDTH}
 * payouts, so longer recipient lists are split into one proof per group of four.
 *
 * The ceiling (R1) is always proven; `bundleRules` adds whatever else the limit
 * carries (allowlist R3 + per-payee cap R5, rolling cap R2, velocity R7, deny R4,
 * ...). Only the allowlist/calendar/category rules need the Poseidon oracle.
 */
/** A rule needs the Poseidon oracle only for allowlist/deny/calendar/category roots. */
function needsPoseidon(rules: PolicyBundleRules): boolean {
  return !!(
    rules.allowlist?.length ||
    rules.denylist?.length ||
    rules.calendarWindows?.length ||
    rules.categoryCeilingsUsdc?.length
  );
}

/**
 * Build the circuit witness (and allowlist) for a rule + salt. The witness is a
 * pure function of (rules, salt), so it is built ONCE per policy and shared across
 * the release groups; the same inputs here, at creation time, and in the vault's
 * verification all yield the same commitment.
 */
async function buildWitness(
  rules: PolicyBundleRules,
  salt: string,
): Promise<{ policy: PolicyWitness; allowlist?: Allowlist }> {
  const b = { rules, salt };
  if (needsPoseidon(rules)) {
    const poseidon = await makePoseidon(DEFAULT_POSEIDON_ARTIFACTS);
    return buildPolicyWitness(b, poseidon);
  }
  return { policy: policyWitnessFromBundle(b) };
}

/**
 * The canonical 32-byte commitment (hex) for a rule + salt, computed with the SDK
 * twin (no proof). This is the value the owner pins and the server stores for a
 * private rule; a later disburse proving the same (rules, salt) reproduces it, so
 * the vault's pinned-set membership check passes. Fetches only the circuit wasm.
 */
export async function computePolicyCommitment(
  rules: PolicyBundleRules,
  salt: string,
): Promise<string> {
  const { policy } = await buildWitness(rules, salt);
  return (await policyCommitment(policy, { wasmPath: WASM })).toString('hex');
}

export async function proveAndReleaseBatch(opts: {
  recipients: ProveRecipient[];
  onPhase?: (phase: ProvePhase, batch?: { i: number; n: number }) => void;
  /**
   * Pinned path: prove this exact committed bundle (rules + the policy's stable
   * salt) so the proof reproduces the on-chain pinned commitment and passes the
   * vault's membership check. The bundle's OWN ceiling is authoritative.
   */
  bundle?: { rules: PolicyBundleRules; salt: string };
  /**
   * Ad-hoc path (no pinned rule): a per-payment ceiling, optionally extending
   * `bundleRules`, proven under a FRESH salt. Not pinnable, so on the pinned-set
   * vault this fails closed; kept for the legacy ceiling-only flow.
   */
  ceilingUsdc?: number;
  bundleRules?: PolicyBundleRules | null;
}): Promise<ProveResult> {
  const { recipients, onPhase, bundle, ceilingUsdc, bundleRules } = opts;

  // Resolve the exact rules + salt the proof binds to. The pinned bundle is used
  // verbatim (its ceiling is the committed one); the ad-hoc path layers the
  // caller's ceiling over the optional bundle and mints a fresh, unpinnable salt.
  let rules: PolicyBundleRules;
  let salt: string;
  if (bundle) {
    rules = bundle.rules;
    salt = bundle.salt;
  } else {
    if (!(ceilingUsdc && ceilingUsdc > 0)) throw new Error('a per-payment ceiling is required');
    rules = bundleRules
      ? { ...bundleRules, perPaymentCeilingUsdc: ceilingUsdc }
      : { perPaymentCeilingUsdc: ceilingUsdc };
    salt = newSalt();
  }
  const ceiling = rules.perPaymentCeilingUsdc;
  if (!(ceiling > 0)) throw new Error('a per-payment ceiling is required');

  const active = recipients.filter((r) => r.payee.trim() && r.amount > 0).slice(0, MAX_RECIPIENTS);
  if (!active.length) throw new Error('no recipients to pay');
  const over = active.find((r) => r.amount > ceiling);
  if (over) throw new Error(`each payout must be at or under the ceiling (${ceiling} USDC)`);

  // Build the policy witness once; it is identical across every release group.
  const { policy, allowlist } = await buildWitness(rules, salt);

  // Read the vault's per-commitment R2/R7 accumulator so each proof binds to the
  // window state the vault re-derives at settlement (the rolling cap + velocity
  // hold ACROSS tasks). A fresh/ad-hoc commitment reads back zeros. Across groups
  // in THIS disburse we advance it locally with the PROVEN reset flags, so a later
  // group doesn't wait for an earlier one to settle.
  const commitmentHex = await computePolicyCommitment(rules, salt);
  const accum = await apiGet<{
    runningSpend: string;
    priorCount: string;
    anchorR2: string;
    anchorR7: string;
  }>(`/vault/accumulator/${commitmentHex}`).catch(() => ({
    runningSpend: '0',
    priorCount: '0',
    anchorR2: '0',
    anchorR7: '0',
  }));

  const groups: ProveRecipient[][] = [];
  for (let i = 0; i < active.length; i += PROOF_WIDTH)
    groups.push(active.slice(i, i + PROOF_WIDTH));

  const jobIds: string[] = [];
  let sum = 0;
  for (let g = 0; g < groups.length; g++) {
    onPhase?.('proving', { i: g + 1, n: groups.length });
    const base = Date.now();
    const releases: BatchRelease[] = groups[g].map((l, i) => {
      const payee = l.payee.trim();
      const membership = allowlist?.membership(payee);
      if (allowlist && !membership)
        throw new Error(`${payee} is not on this limit's approved-payee list`);
      return {
        payeeAddress: payee,
        amountStroops: String(BigInt(Math.round(l.amount * STROOPS))),
        spendCounter: String(base + i),
        membership,
      };
    });
    const now = Math.floor(Date.now() / 1000);
    const validAfter = String(now - 3600);
    const ctx: BatchContext = {
      validAfter,
      validBefore: String(now + 86400),
      runningSpend: accum.runningSpend,
      priorCount: accum.priorCount,
      anchorR2: accum.anchorR2,
      anchorR7: accum.anchorR7,
    };
    const proof = await createBatchProof(policy, releases, ctx, { wasmPath: WASM, zkeyPath: ZKEY });
    const groupStroops = releases.reduce((s, r) => s + BigInt(r.amountStroops), 0n);
    sum += Number(groupStroops) / STROOPS;
    const request = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: Number(groupStroops) / STROOPS,
      stepId: (base + g) % 1_000_000,
    });
    onPhase?.('relaying', { i: g + 1, n: groups.length });
    const resp = await apiPost<{ jobId: string }>('/vault/batch-release-proved', request);
    jobIds.push(resp.jobId);
    // Advance the local accumulator for the next group using the PROVEN reset flags
    // (exactly how the vault rolls it on each settled batch).
    accum.runningSpend = String((proof.resetR2 ? 0n : BigInt(accum.runningSpend)) + groupStroops);
    accum.priorCount = String((proof.resetR7 ? 0 : Number(accum.priorCount)) + releases.length);
    if (proof.resetR2) accum.anchorR2 = validAfter;
    if (proof.resetR7) accum.anchorR7 = validAfter;
  }
  onPhase?.('done');
  return { jobIds, total: sum, legs: active.length, batches: groups.length };
}

interface BatchJobStatus {
  state: string;
  result: { status: 'settled' | 'skipped' | 'failed'; txHash?: string; reason?: string } | null;
  failedReason?: string;
}

export interface BatchOutcome {
  settled: number;
  failed: number;
  /** Jobs we could not confirm before the deadline (still settling, or evicted). */
  unconfirmed: number;
  txHashes: string[];
  reasons: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Relaying a proof is not the same as it settling on-chain, and a release can fail
 * after it is accepted. This polls each batch job for its TRUE outcome so the UI can
 * report "Completed" / "Failed" honestly instead of a premature "Accepted". Batch
 * jobs are non-retryable, so a `completed` state is always final. Jobs still pending
 * at the deadline are reported as `unconfirmed` (the Activity feed is the source of
 * truth once the worker finishes).
 */
export async function pollBatchJobs(
  jobIds: string[],
  opts?: { timeoutMs?: number; intervalMs?: number; onProgress?: (o: BatchOutcome) => void },
): Promise<BatchOutcome> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 2500;
  const deadline = Date.now() + timeoutMs;
  const done = new Map<string, { ok: boolean; txHash?: string; reason?: string }>();

  const summarize = (): BatchOutcome => {
    let settled = 0;
    let failed = 0;
    const txHashes: string[] = [];
    const reasons: string[] = [];
    for (const r of done.values()) {
      if (r.ok) {
        settled++;
        if (r.txHash) txHashes.push(r.txHash);
      } else {
        failed++;
        if (r.reason) reasons.push(r.reason);
      }
    }
    return { settled, failed, unconfirmed: jobIds.length - done.size, txHashes, reasons };
  };

  while (done.size < jobIds.length && Date.now() < deadline) {
    for (const id of jobIds) {
      if (done.has(id)) continue;
      try {
        const j = await apiGet<BatchJobStatus>(`/vault/batch-job/${encodeURIComponent(id)}`);
        if (j.state === 'completed') {
          if (j.result?.status === 'settled') done.set(id, { ok: true, txHash: j.result.txHash });
          else done.set(id, { ok: false, reason: j.result?.reason ?? 'settlement failed' });
        } else if (j.state === 'failed') {
          done.set(id, { ok: false, reason: j.failedReason ?? 'settlement failed' });
        }
        // waiting | active | delayed | unknown: not terminal yet, keep polling.
      } catch {
        // transient (network/401 refresh); retry on the next tick.
      }
    }
    opts?.onProgress?.(summarize());
    if (done.size < jobIds.length) await sleep(intervalMs);
  }
  return summarize();
}
