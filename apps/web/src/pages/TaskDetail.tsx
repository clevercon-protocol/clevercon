import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ListChecks,
  Receipt as ReceiptIcon,
  Flag,
  ShieldCheck,
  ExternalLink,
  Clock,
  CheckCircle2,
  Sparkles,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { getTask, raiseDispute, approveTask, type TaskDetail as TaskDetailData } from '../lib/tasks';
import { getDelegate } from '../lib/vault';
import { config } from '../config';

const EXPLORER_NET = config.network === 'mainnet' ? 'public' : 'testnet';
const explorerTx = (hash: string) => `https://stellar.expert/explorer/${EXPLORER_NET}/tx/${hash}`;
const shortHash = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

function DisputeButton({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const raise = useMutation({
    mutationFn: () => raiseDispute(taskId, 'Buyer disputes the outcome'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId] }),
  });
  if (raise.isSuccess) {
    return <span className="text-xs text-amber-300">Dispute raised (under review)</span>;
  }
  return (
    <button
      onClick={() => raise.mutate()}
      disabled={raise.isPending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
      title="Raise a dispute for an operator to review"
    >
      <Flag size={12} /> {raise.isPending ? 'Raising…' : 'Raise dispute'}
    </button>
  );
}

/** A coarse, non-ticking "time until" label for the dispute-window countdown. */
function until(target: number): string {
  const diff = target - Date.now();
  if (diff <= 0) return 'shortly';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ~${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ~${hrs}h`;
  return `in ~${Math.round(hrs / 24)}d`;
}

/**
 * Shown while a T2 delivery is in its dispute window: the funds sit in escrow
 * (the on-chain lock) until the window ends. The buyer can approve early to pay
 * the provider now, or dispute (the header button) to freeze it for a resolver.
 */
function ReviewBanner({ task }: { task: TaskDetailData }) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () => approveTask(task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', task.id] }),
  });
  const releaseAt = task.steps
    .filter((s) => s.status === 'AWAITING_APPROVAL' && s.releaseAt)
    .map((s) => Date.parse(s.releaseAt as string))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)[0];
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Clock size={18} className="shrink-0 text-amber-300" />
        <div className="min-w-0">
          <div className="font-medium text-amber-200">
            {releaseAt ? 'In review (dispute window)' : 'Awaiting your approval'}
          </div>
          <p className="text-xs text-slate-400">
            {releaseAt ? (
              <>
                The delivery is held in escrow and releases to the provider {until(releaseAt)}{' '}
                unless you dispute it. Approve now to pay immediately.
              </>
            ) : (
              <>
                The delivery is held in escrow and waits for your approval before the provider is
                paid. Approve to release, or dispute if it is not acceptable.
              </>
            )}
          </p>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <CheckCircle2 size={13} /> {approve.isPending ? 'Releasing…' : 'Approve & release now'}
          </button>
        </div>
      </div>
      {approve.error && (
        <p className="mt-2 text-xs text-amber-300">
          {(approve.error as Error).message || 'Could not approve right now.'}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when a job finished running but no payment settled on-chain (spent is 0).
 * The usual cause is Autopay being off, so the vault can't pay the provider on
 * the buyer's behalf, or an unfunded vault. We say so plainly rather than letting
 * a "COMPLETED" badge imply money moved.
 */
function UnpaidBanner({ task }: { task: TaskDetailData }) {
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });
  const ranUnpaid = task.status === 'COMPLETED' && task.spent === 0 && task.budget > 0;
  if (!ranUnpaid) return null;
  const autopayOff = delegate ? !delegate.registered : false;
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="text-sm text-slate-300">
          <div className="font-medium text-amber-200">Completed, but no payment settled</div>
          {autopayOff ? (
            <p className="mt-1 text-xs text-slate-400">
              The job ran, but <span className="text-slate-300">Autopay is off</span>, so the vault
              couldn&apos;t pay the provider on your behalf. No funds moved and no receipt was
              created.{' '}
              <Link to="/app/vault" className="text-violet-300 hover:text-violet-200">
                Enable Autopay
              </Link>{' '}
              so future hires settle automatically.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              The job ran, but nothing settled on-chain yet. If your vault is funded and Autopay is
              on, settlement may still be processing; otherwise check your{' '}
              <Link to="/app/vault" className="text-violet-300 hover:text-violet-200">
                vault balance
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_TINT: Record<string, string> = {
  RUNNING: 'text-sky-300',
  RELEASED: 'text-emerald-300',
  CONFIRMED: 'text-emerald-300',
  COMPLETED: 'text-emerald-300',
  PENDING: 'text-amber-300',
  SUBMITTED: 'text-sky-300',
  AWAITING_APPROVAL: 'text-amber-300',
  DRAFT: 'text-slate-400',
  CANCELLED: 'text-slate-500',
  SKIPPED: 'text-slate-500',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
};

function tint(s: string): string {
  return STATUS_TINT[s] ?? 'text-slate-400';
}

function fmt(v: string): string {
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toLocaleString();
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Public-bucket artifacts carry an absolute URL; a relative one resolves via the API. */
function resolveArtifactUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${config.apiUrl}${url}`;
}

export function TaskDetail() {
  const { id = '' } = useParams();
  const {
    data: task,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['task', id],
    queryFn: () => getTask(id),
  });

  return (
    <section className="space-y-6">
      <Link
        to="/app/jobs"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} /> Back to jobs
      </Link>

      {isLoading && <p className="text-sm text-slate-500">Loading job…</p>}
      {error && <p className="text-sm text-red-400">Could not load this job.</p>}

      {task && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{task.title}</h1>
              <span className={`text-sm ${tint(task.status)}`}>{task.status}</span>
              <div className="ml-auto">
                <DisputeButton taskId={task.id} />
              </div>
            </div>
            {task.description && <p className="mt-1 text-slate-400">{task.description}</p>}
            <p className="mt-1 text-sm text-slate-500">
              {task.mode} · created {fmt(task.createdAt)}
            </p>
          </div>

          {task.awaitingApproval && <ReviewBanner task={task} />}
          <UnpaidBanner task={task} />

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Budget', `$${task.budget.toFixed(2)}`],
              ['Spent', `$${task.spent.toFixed(2)}`],
              ['Steps', `${task.completedSteps}/${task.stepCount}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-slate-300">
              <ListChecks size={18} className="text-violet-300" />
              <h2 className="font-semibold">Steps</h2>
            </div>
            {task.steps.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No steps yet. Search and compose jobs plan their steps when they run.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {task.steps.map((s) => (
                  <div key={s.index} className="rounded-xl bg-white/[0.04] p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {s.index + 1}. {s.action}
                        </div>
                        <div className="text-xs text-slate-500">
                          {s.service ?? 'unassigned'}
                          {s.latencyMs != null && ` · ${s.latencyMs}ms`}
                          {s.error && ` · ${s.error}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-300">${s.estimatedCost.toFixed(2)}</div>
                        <div className={`text-xs ${tint(s.status)}`}>{s.status}</div>
                      </div>
                    </div>
                    {s.qualityRating != null && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-sky-300">
                        <Sparkles size={12} className="mt-0.5 shrink-0" />
                        <span>
                          Quality check: {s.qualityRating.toFixed(1)}/5
                          {s.qualityNote ? ` · ${s.qualityNote}` : ''}
                          <span className="text-slate-500"> (advisory, not a payment gate)</span>
                        </span>
                      </div>
                    )}
                    {s.artifact && (
                      <a
                        href={resolveArtifactUrl(s.artifact.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] text-violet-300 hover:bg-white/10"
                        title={s.artifact.hash ?? undefined}
                      >
                        <Download size={12} /> Download file · {s.artifact.contentType} ·{' '}
                        {fmtBytes(s.artifact.size)}
                        {s.artifact.hash && (
                          <span className="text-slate-500"> · {s.artifact.hash.slice(0, 20)}…</span>
                        )}
                      </a>
                    )}
                    {s.output && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-2 text-[11px] text-slate-400">
                        {s.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-slate-300">
              <ReceiptIcon size={18} className="text-violet-300" />
              <h2 className="font-semibold">Receipts</h2>
            </div>
            {task.receipts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No payments yet. Receipts appear here once the job runs.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {task.receipts.map((r) => (
                  <div key={r.id} className="rounded-xl bg-white/[0.04] p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">
                          ${r.amount.toFixed(2)} {r.asset} · {r.method}
                        </div>
                        <div className="truncate font-mono text-xs text-slate-500">
                          to {r.toAddress}
                          {r.txHash && (
                            <>
                              {' · '}
                              <a
                                href={explorerTx(r.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
                              >
                                {shortHash(r.txHash)} <ExternalLink size={11} />
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs ${tint(r.status)}`}>{r.status}</div>
                        <div className="text-xs text-slate-500">{fmt(r.createdAt)}</div>
                      </div>
                    </div>
                    {r.method === 'VAULT_RELEASE' && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-violet-300">
                        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                        Proof-gated release: the ledger shows this payment and that it passed your
                        policy check. The rule itself is committed as a hash and never published.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
