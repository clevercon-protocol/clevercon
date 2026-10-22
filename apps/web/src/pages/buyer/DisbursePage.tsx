import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Plus,
  X,
  Lock,
  Check,
  ExternalLink,
  Fingerprint,
  Cpu,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { getPolicies, type Policy } from '../../lib/policies';
import { getVault, getDelegate } from '../../lib/vault';
import { describeSavedLimit, savedLimitBundleRules, resolvePinnedBundle } from './limits-model';
import {
  proveAndReleaseBatch,
  pollBatchJobs,
  PROOF_WIDTH,
  MAX_RECIPIENTS,
  type BatchOutcome,
} from '../../lib/prove';
import type { PolicyBundleRules } from '@clevercon/agent-sdk/prover';

// Persist the in-progress recipients + ceiling so navigating away and back does not
// lose a half-filled disbursement.
const DRAFT_KEY = 'cc:disburse:draft';
const loadDraft = (): { ceiling: string; lines: Line[] } | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as { ceiling: string; lines: Line[] }) : null;
  } catch {
    return null;
  }
};

type Line = { payee: string; amount: string };
type Result = { jobIds: string[]; total: number; legs: number; batches: number };
type Phase = 'idle' | 'proving' | 'relaying' | 'done';

/**
 * pp/2 trustless disburse. The owner's private policy becomes a Groth16 proof IN
 * THE BROWSER; only the proof is relayed and the chain verifies it before the
 * vault releases. A proof covers up to {@link PROOF_WIDTH} payouts, so longer
 * recipient lists are split automatically into one proof per group of four.
 */
export function DisbursePage() {
  const draft = loadDraft();
  const [ceiling, setCeiling] = useState(draft?.ceiling ?? '10');
  // The picked saved limit's full prover rules (allowlist, rolling cap, velocity,
  // deny-list), for the pre-flight checks and pills. A pinned private rule is
  // proven as its EXACT committed bundle, so once a limit is picked its ceiling is
  // authoritative (the field locks to it) and the proof reproduces the pinned
  // commitment the vault requires.
  const [savedBundle, setSavedBundle] = useState<PolicyBundleRules | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? [{ payee: '', amount: '' }]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  // After relaying, we poll each job for its true on-chain outcome so the panel can
  // say "Completed" / "Failed" instead of a premature "Accepted".
  const [confirming, setConfirming] = useState(false);
  const [settle, setSettle] = useState<BatchOutcome | null>(null);
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });
  const available = vault?.available ?? 0;
  const autopayOn = delegate?.registered ?? false;

  // Persist the draft (recipients + ceiling) so it survives navigation.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ceiling, lines }));
    } catch {
      // ignore
    }
  }, [ceiling, lines]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => (ls.length < MAX_RECIPIENTS ? [...ls, { payee: '', amount: '' }] : ls));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  const active = lines
    .filter((l) => l.payee.trim() && Number(l.amount) > 0)
    .slice(0, MAX_RECIPIENTS);
  const total = active.reduce((s, l) => s + Number(l.amount), 0);
  const batches = Math.max(1, Math.ceil(active.length / PROOF_WIDTH));

  // If the picked limit carries an allowlist (R3), every recipient must be on it:
  // the proof cannot authorise a payee outside the committed set. Flag any early so
  // the owner sees it before proving rather than as a proof failure.
  const allowSet = savedBundle?.allowlist?.length
    ? new Set(savedBundle.allowlist.map((e) => e.payeeAddress.trim()))
    : null;
  const offAllowlist = allowSet ? active.filter((l) => !allowSet.has(l.payee.trim())) : [];

  // Preconditions the chain would otherwise fail on: you can only spend what's in
  // the vault, and a release needs the bounded delegate (autopay) authorized. Block
  // and guide BEFORE proving, instead of proving and then silently failing on-chain.
  const insufficient = total > available && active.length > 0;
  const blocker: null | 'autopay' | 'balance' = !autopayOn
    ? 'autopay'
    : insufficient
      ? 'balance'
      : null;
  const canSubmit =
    Number(ceiling) > 0 && active.length > 0 && offAllowlist.length === 0 && blocker === null;

  const disburse = useMutation<Result>({
    mutationFn: async () => {
      const recipients = active.map((l) => ({ payee: l.payee, amount: Number(l.amount) }));
      // A picked private limit is proven as its EXACT committed bundle (rules +
      // stable salt), so the proof reproduces the on-chain pinned commitment and
      // the vault accepts it. Resolve it from this device, or the wallet-encrypted
      // backup. With no limit picked, fall back to the ad-hoc ceiling-only path
      // (not pinnable; fails closed on the pinned-set vault).
      const pinned = selectedPolicy ? await resolvePinnedBundle(selectedPolicy) : null;
      if (selectedPolicy && !pinned) {
        throw new Error(
          'This limit was created on another device and has no backup, so it cannot be proven here. Re-create it on this device, or pick another.',
        );
      }
      return proveAndReleaseBatch({
        bundle: pinned ?? undefined,
        ceilingUsdc: pinned ? undefined : Number(ceiling),
        bundleRules: pinned ? undefined : savedBundle,
        recipients,
        onPhase: (p, batch) => {
          if (p === 'done') {
            setPhase('done');
            setProgress(null);
          } else {
            setPhase(p);
            if (batch) setProgress(batch);
          }
        },
      });
    },
    onMutate: () => {
      setSettle(null);
      setConfirming(false);
    },
    onSuccess: async (data) => {
      // The batch was relayed; drop the saved draft so it doesn't persist a sent list.
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      // Now confirm the REAL outcome on-chain before claiming success.
      setConfirming(true);
      const outcome = await pollBatchJobs(data.jobIds, { onProgress: setSettle });
      setSettle(outcome);
      setConfirming(false);
    },
    onError: () => {
      setPhase('idle');
      setProgress(null);
      setConfirming(false);
    },
  });

  const busy = disburse.isPending;
  const done = phase === 'done' && !!disburse.data;
  const stepState = (i: number): 'done' | 'active' | 'todo' => {
    if (i === 0) return phase !== 'idle' ? 'done' : 'todo';
    if (i === 1)
      return done || phase === 'relaying' ? 'done' : phase === 'proving' ? 'active' : 'todo';
    return done ? 'done' : phase === 'relaying' ? 'active' : 'todo';
  };
  const batchNote = progress && progress.n > 1 ? ` · batch ${progress.i} of ${progress.n}` : '';

  return (
    <div className="cc-stagger space-y-7">
      <header>
        <p className="cc-eyebrow">Private payments</p>
        <h1 className="cc-title mt-2">Trustless disburse</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Pay many recipients under one private spending rule, proven in your browser with
          zero-knowledge and enforced on-chain. The server only relays the proof; it never sees your
          rule and cannot forge it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            ic: ShieldCheck,
            t: 'Set a private rule',
            d: 'A per-payment ceiling only you can see.',
          },
          {
            ic: Fingerprint,
            t: 'Prove in your browser',
            d: 'Groth16; the rule never leaves this device.',
          },
          {
            ic: Cpu,
            t: 'The chain verifies & pays',
            d: 'The vault checks the proof, then releases.',
          },
        ].map((s, i) => (
          <div key={i} className="cc-card flex items-start gap-3 p-4">
            <span className="cc-ic">
              <s.ic size={17} />
            </span>
            <div>
              <div className="text-[13.5px] font-semibold text-white">{s.t}</div>
              <div className="mt-0.5 text-xs text-slate-500">{s.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Compose */}
        <div className="cc-card p-5">
          <div className="flex items-center gap-3">
            <span className="cc-ic">
              <ShieldCheck size={17} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-white">Compose the disbursement</h2>
              <p className="text-xs text-slate-500">Nothing about the rule leaves your browser.</p>
            </div>
          </div>

          <form
            className="mt-5 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !busy) disburse.mutate();
            }}
          >
            {policies.length > 0 && (
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                  Start from a saved limit (optional)
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const p = policies.find((x) => x.id === e.target.value) ?? null;
                    const b = p ? savedLimitBundleRules(p) : null;
                    setSelectedPolicy(p);
                    setSavedBundle(b);
                    if (b?.perPaymentCeilingUsdc) setCeiling(String(b.perPaymentCeilingUsdc));
                  }}
                  className="cc-input mt-1.5 text-sm"
                  aria-label="Start from a saved limit"
                >
                  <option value="">No saved limit · ceiling only…</option>
                  {policies.map((p) => {
                    const readable = !!savedLimitBundleRules(p);
                    return (
                      <option key={p.id} value={p.id} disabled={!readable}>
                        {describeSavedLimit(p)}
                        {!readable ? ' · created on another device' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  Proves the whole limit on-chain in your browser: the ceiling plus the saved
                  limit&apos;s approved-payee allowlist, rolling cap, and deny-list. Nothing about
                  the rule leaves this device; only the proof is relayed.
                </p>
              </div>
            )}

            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                Per-payment ceiling (USDC) · the private rule
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                disabled={!!selectedPolicy}
                className="cc-input cc-num mt-1.5 w-44 disabled:opacity-60"
                aria-label="Per-payment ceiling in USDC"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                {selectedPolicy
                  ? 'Fixed by the pinned limit: the proof must match its committed rule exactly.'
                  : 'Every payout is checked at or under this, inside the proof.'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                Recipients
              </label>
              {lines.map((l, i) => {
                const overLimit = Number(l.amount) > Number(ceiling) && Number(l.amount) > 0;
                const offList =
                  !!allowSet && l.payee.trim() !== '' && !allowSet.has(l.payee.trim());
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      placeholder="Payee address (G...)"
                      value={l.payee}
                      onChange={(e) => setLine(i, { payee: e.target.value })}
                      className={`cc-input min-w-0 flex-1 font-mono text-xs ${offList ? '!border-amber-500/60' : ''}`}
                      aria-label={`Payee ${i + 1} address`}
                    />
                    <div className="relative shrink-0" style={{ width: '7.5rem' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                        className={`cc-input cc-num pr-11 ${overLimit ? '!border-amber-500/60' : ''}`}
                        aria-label={`Payee ${i + 1} amount in USDC`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-500">
                        USDC
                      </span>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                        aria-label={`Remove recipient ${i + 1}`}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
              {lines.length < MAX_RECIPIENTS && (
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 transition-colors hover:text-violet-200"
                >
                  <Plus size={14} /> Add recipient
                </button>
              )}
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                <Layers size={12} className="text-violet-300" />
                One proof covers {PROOF_WIDTH} payouts; longer lists are proven in {PROOF_WIDTH}
                -at-a-time batches automatically.
              </p>
              {offAllowlist.length > 0 && (
                <p className="text-[11px] text-amber-300">
                  {offAllowlist.length} recipient{offAllowlist.length > 1 ? 's are' : ' is'} not on
                  this limit&apos;s approved-payee list. The proof can only pay approved payees.
                </p>
              )}
            </div>

            {savedBundle && (
              <div className="flex flex-wrap gap-1.5">
                <span className="cc-pill">Ceiling</span>
                {savedBundle.allowlist?.length ? (
                  <span className="cc-pill">Allowlist · {savedBundle.allowlist.length}</span>
                ) : null}
                {savedBundle.rollingCapUsdc != null ? (
                  <span className="cc-pill">Rolling cap</span>
                ) : null}
                {savedBundle.maxReleasesPerWindow != null ? (
                  <span className="cc-pill">Velocity</span>
                ) : null}
                {savedBundle.denylist?.length ? <span className="cc-pill">Deny-list</span> : null}
                <span className="ml-1 self-center text-[11px] text-slate-500">
                  proven on-chain in this disbursement
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <div className="text-sm text-slate-400">
                Total{' '}
                <span className="cc-num ml-1 font-semibold text-white">
                  {total.toFixed(2)} USDC
                </span>
                {active.length > 0 && (
                  <span className="ml-2 text-xs text-slate-600">
                    · {active.length} payout{active.length > 1 ? 's' : ''} · {batches} proof
                    {batches > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button type="submit" className="cc-btn" disabled={!canSubmit || busy}>
                <Lock size={15} />
                {busy ? `Proving…` : 'Prove & disburse'}
              </button>
            </div>
            {blocker === 'autopay' && (
              <p className="text-sm text-amber-300">
                Autopay isn&apos;t enabled yet.{' '}
                <Link to="/app/vault" className="font-medium underline hover:text-amber-200">
                  Authorize the delegate
                </Link>{' '}
                once so the vault can release payments, then come back.
              </p>
            )}
            {blocker === 'balance' && (
              <p className="text-sm text-amber-300">
                Not enough in your vault: this needs {total.toFixed(2)} USDC but{' '}
                {available.toFixed(2)} is available.{' '}
                <Link to="/app/vault" className="font-medium underline hover:text-amber-200">
                  Fund your vault
                </Link>{' '}
                first.
              </p>
            )}
            {disburse.error && (
              <p className="text-sm text-amber-300">{(disburse.error as Error).message}</p>
            )}
          </form>
        </div>

        {/* Proof panel */}
        <div className="cc-card cc-card-lg overflow-hidden">
          <div className="cc-glow relative border-b border-line px-5 py-4">
            <svg
              className="cc-seal pointer-events-none absolute -right-6 -top-6 h-32 w-32 opacity-40"
              viewBox="0 0 100 100"
              fill="none"
              stroke="var(--violet)"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="50" cy="50" r="28" />
              <circle cx="50" cy="50" r="37" strokeDasharray="3 6" />
              <path d="M38 50l8 8 18-18" strokeWidth="2.4" />
            </svg>
            <div className="cc-eyebrow">Groth16 · BLS12-381</div>
            <p className="mt-1 text-xs text-slate-400">
              Verified on-chain by Soroban&apos;s native pairing. No trusted prover.
            </p>
          </div>
          <div className="px-5 py-4">
            {[
              {
                t: `Witness built in your browser${busy ? batchNote : ''}`,
                d: 'your policy + a fresh salt, never transmitted',
              },
              { t: 'Zero-knowledge proof generated', d: 'snarkjs over the deployed circuit' },
              {
                t: 'Verified on-chain, funds released',
                d: 'the vault checks it before moving funds',
              },
            ].map((s, i, arr) => {
              const st = stepState(i);
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${
                        st === 'done'
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                          : st === 'active'
                            ? 'cc-breathe bg-violet-500/20 text-violet-200 ring-violet-500/40'
                            : 'bg-white/[0.04] text-slate-500 ring-white/10'
                      }`}
                    >
                      {st === 'done' ? <Check size={13} /> : i + 1}
                    </span>
                    {i < arr.length - 1 && <span className="my-1 w-px flex-1 bg-line-strong" />}
                  </div>
                  <div className="pb-4">
                    <div
                      className={`text-[13.5px] font-semibold ${st === 'todo' ? 'text-slate-400' : 'text-white'}`}
                    >
                      {s.t}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{s.d}</div>
                  </div>
                </div>
              );
            })}

            {done && disburse.data ? (
              (() => {
                const d = disburse.data;
                const allOk = !!settle && settle.failed === 0 && settle.unconfirmed === 0;
                const anyFailed = !!settle && settle.failed > 0;
                const proofs = `${d.batches} proof${d.batches > 1 ? 's' : ''}`;
                const people = `${d.legs} recipient${d.legs > 1 ? 's' : ''}`;
                return (
                  <div
                    className={`cc-pop mt-1 rounded-xl p-3 ${
                      !confirming && anyFailed
                        ? 'bg-amber-500/[0.07]'
                        : !confirming && allOk
                          ? 'bg-emerald-500/[0.07]'
                          : 'bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`cc-pill ${!confirming && allOk ? 'cc-pill-good' : ''}`}>
                        {confirming ? (
                          <>
                            <span className="cc-dot cc-breathe" /> Confirming on-chain…
                          </>
                        ) : allOk ? (
                          <>
                            <span className="cc-dot" /> Completed
                          </>
                        ) : anyFailed ? (
                          'Some payouts failed'
                        ) : (
                          'Still settling'
                        )}
                      </span>
                      <span className="cc-num text-sm font-semibold text-white">
                        {d.total.toFixed(2)} USDC
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {confirming
                        ? `Verifying ${people} across ${proofs}${settle ? ` · ${settle.settled} settled` : ''}…`
                        : allOk
                          ? `Paid ${people} across ${proofs}, verified on-chain.`
                          : anyFailed
                            ? `${settle!.settled} of ${proofs} settled, ${settle!.failed} failed. Funds for failed payouts stay safe in your vault.`
                            : `Relayed ${people}. Still settling; the Activity feed will show the final result.`}
                    </p>
                    {!confirming && anyFailed && settle!.reasons.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-300">{settle!.reasons[0]}</p>
                    )}
                    <a
                      href="/app/activity"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                    >
                      {!confirming && allOk ? 'View in Activity' : 'Track in Activity'}{' '}
                      <ExternalLink size={11} />
                    </a>
                  </div>
                );
              })()
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                First proof fetches the circuit (~37MB, cached after). Each proof takes a few
                seconds.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
