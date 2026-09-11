import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ListChecks, Receipt as ReceiptIcon, Flag } from 'lucide-react';
import { getTask, raiseDispute } from '../lib/tasks';

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
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
      title="Raise a dispute for an operator to review"
    >
      <Flag size={12} /> {raise.isPending ? 'Raising…' : 'Raise dispute'}
    </button>
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

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Budget', `$${task.budget.toFixed(2)}`],
              ['Spent', `$${task.spent.toFixed(2)}`],
              ['Steps', `${task.completedSteps}/${task.stepCount}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
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
                  <div
                    key={s.index}
                    className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
                  >
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

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
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
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">
                        ${r.amount.toFixed(2)} {r.asset} · {r.method}
                      </div>
                      <div className="truncate font-mono text-xs text-slate-500">
                        to {r.toAddress}
                        {r.txHash && ` · ${r.txHash}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs ${tint(r.status)}`}>{r.status}</div>
                      <div className="text-xs text-slate-500">{fmt(r.createdAt)}</div>
                    </div>
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
