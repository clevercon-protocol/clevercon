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
  versioned,
  type BatchRelease,
  type BatchContext,
  type Allowlist,
  type PolicyWitness,
  type PolicyBundleRules,
} from '@clevercon/agent-sdk/prover';

const STROOPS = 10_000_000;
// Cache-busted so a browser/CDN that cached an older circuit wasm under the bare
// URL re-fetches the current one (a stale wasm yields the wrong public-signal
// count and breaks commitment/proof).
const WASM = versioned(`${DEFAULT_ARTIFACT_BASE_URL}/policy_batch.wasm`);
const ZKEY = versioned(`${DEFAULT_ARTIFACT_BASE_URL}/policy_batch_final.zkey`);

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
  /** On-chain tx hashes, one per proof group. The keyless path settles synchronously. */
  txHashes: string[];
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
  /**
   * The global-private rule (its pinned bundle), when one is set. The vault requires
   * a SECOND proof that the SAME batch also satisfies this rule (an AND filter), so
   * each group is proven twice: once against the selected rule, once against the
   * global. Omit when no global-private is set.
   */
  globalBundle?: { rules: PolicyBundleRules; salt: string } | null;
}): Promise<ProveResult> {
  const { recipients, onPhase, bundle, ceilingUsdc, bundleRules, globalBundle } = opts;

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

  // When a global-private rule is set, build its witness + read its own accumulator
  // too: every group is proven a SECOND time against it, and its window rolls
  // independently of the selected rule's.
  const g = globalBundle
    ? await (async () => {
        const w = await buildWitness(globalBundle.rules, globalBundle.salt);
        const gCommitment = await computePolicyCommitment(globalBundle.rules, globalBundle.salt);
        const gAccum = await apiGet<{
          runningSpend: string;
          priorCount: string;
          anchorR2: string;
          anchorR7: string;
        }>(`/vault/accumulator/${gCommitment}`).catch(() => ({
          runningSpend: '0',
          priorCount: '0',
          anchorR2: '0',
          anchorR7: '0',
        }));
        return { policy: w.policy, allowlist: w.allowlist, accum: gAccum };
      })()
    : null;

  const groups: ProveRecipient[][] = [];
  for (let i = 0; i < active.length; i += PROOF_WIDTH)
    groups.push(active.slice(i, i + PROOF_WIDTH));

  const txHashes: string[] = [];
  let sum = 0;
  for (let batchIdx = 0; batchIdx < groups.length; batchIdx++) {
    onPhase?.('proving', { i: batchIdx + 1, n: groups.length });
    const base = Date.now();
    const releases: BatchRelease[] = groups[batchIdx].map((l, i) => {
      const payee = l.payee.trim();
      const membership = allowlist?.membership(payee);
      if (allowlist && !membership)
        throw new Error(`${payee} is not on this rule's approved-payee list`);
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

    // GLOBAL-private AND filter: prove the SAME batch also satisfies the global rule,
    // under the global commitment's own window. Same payees/amounts/window; its own
    // allowlist membership and (distinct-salt) nullifiers.
    let globalField: {
      commitment: string;
      nullifiers: string[];
      resetR2: boolean;
      resetR7: boolean;
      proof: { a: string; b: string; c: string };
    } | null = null;
    if (g) {
      const gReleases: BatchRelease[] = groups[batchIdx].map((l, i) => {
        const payee = l.payee.trim();
        const membership = g.allowlist?.membership(payee);
        if (g.allowlist && !membership)
          throw new Error(`${payee} is not on your global rule's approved-payee list`);
        return {
          payeeAddress: payee,
          amountStroops: String(BigInt(Math.round(l.amount * STROOPS))),
          spendCounter: String(base + i),
          membership,
        };
      });
      const gCtx: BatchContext = {
        validAfter,
        validBefore: String(now + 86400),
        runningSpend: g.accum.runningSpend,
        priorCount: g.accum.priorCount,
        anchorR2: g.accum.anchorR2,
        anchorR7: g.accum.anchorR7,
      };
      const gProof = await createBatchProof(g.policy, gReleases, gCtx, {
        wasmPath: WASM,
        zkeyPath: ZKEY,
      });
      globalField = {
        commitment: gProof.commitment.toString('hex'),
        nullifiers: gProof.nullifiers.map((n) => n.toString('hex')),
        resetR2: gProof.resetR2,
        resetR7: gProof.resetR7,
        proof: {
          a: gProof.proof.a.toString('hex'),
          b: gProof.proof.b.toString('hex'),
          c: gProof.proof.c.toString('hex'),
        },
      };
      // Roll the global window forward for the next group, exactly like the primary.
      g.accum.runningSpend = String(
        (gProof.resetR2 ? 0n : BigInt(g.accum.runningSpend)) + groupStroops,
      );
      g.accum.priorCount = String(
        (gProof.resetR7 ? 0 : Number(g.accum.priorCount)) + gReleases.length,
      );
      if (gProof.resetR2) g.accum.anchorR2 = validAfter;
      if (gProof.resetR7) g.accum.anchorR7 = validAfter;
    }

    // The keyless endpoint ignores the task meta (vaultTaskId/planCostUsdc/stepId);
    // it draws from the user's balance directly, authorized by the proof(s). We reuse
    // the request builder for the proof/nullifier/payee mapping, attach `global` when
    // set, and POST to the KEYLESS path: no delegate, no per-payment signature,
    // settled synchronously (returns a tx hash).
    const request = buildBatchReleaseRequest(proof, releases, ctx, {
      vaultTaskId: null,
      planCostUsdc: Number(groupStroops) / STROOPS,
      stepId: (base + batchIdx) % 1_000_000,
    });
    onPhase?.('relaying', { i: batchIdx + 1, n: groups.length });
    const resp = await apiPost<{ txHash: string }>('/vault/batch-release-keyless', {
      ...request,
      global: globalField,
    });
    txHashes.push(resp.txHash);
    // Advance the local accumulator for the next group using the PROVEN reset flags
    // (exactly how the vault rolls it on each settled batch).
    accum.runningSpend = String((proof.resetR2 ? 0n : BigInt(accum.runningSpend)) + groupStroops);
    accum.priorCount = String((proof.resetR7 ? 0 : Number(accum.priorCount)) + releases.length);
    if (proof.resetR2) accum.anchorR2 = validAfter;
    if (proof.resetR7) accum.anchorR7 = validAfter;
  }
  onPhase?.('done');
  return { txHashes, total: sum, legs: active.length, batches: groups.length };
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
