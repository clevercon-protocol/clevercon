import { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Clock, ChevronDown, TrendingDown, Zap } from 'lucide-react';
import { approveTask, rejectTask } from '../lib/api';

export interface StepSelection {
  step_id: number;
  agent_id: string;
  agent_name: string;
  action: string;
  payment_method: 'x402' | 'mpp';
  estimated_cost: number;
  depends_on: number | number[] | null;
  selected_score: number;
  selected_rank: number;
  total_candidates: number;
  score_breakdown: {
    capability_match: number;
    reputation: number;
    price_efficiency: number;
    latency_score: number;
    discovery_bonus: number;
  } | null;
  alternatives: Array<{ agent_id: string; name: string; score: number }>;
}

export interface PendingPlan {
  task_id: string;
  task: string;
  reasoning: string;
  total_estimated_cost: number;
  steps: StepSelection[];
  auto_approve_in_ms: number;
}

interface Props {
  plan: PendingPlan;
  onDismiss: () => void;
  orchestratorName?: string;
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs text-gray-500 w-32 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right tabular-nums">{pct}%</span>
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 0.7) return 'text-emerald-400';
  if (score >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(score: number) {
  if (score >= 0.7) return 'bg-emerald-950 border-emerald-800 text-emerald-400';
  if (score >= 0.4) return 'bg-amber-950 border-amber-800 text-amber-400';
  return 'bg-red-950 border-red-800 text-red-400';
}

export function PlanApproval({ plan, onDismiss, orchestratorName = 'Your Agent' }: Props) {
  const totalSeconds = Math.ceil(plan.auto_approve_in_ms / 1000);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const hasAutoApproved = useRef(false);

  const handleApprove = async () => {
    if (acting !== null) return;
    setActing('approve');
    try { await approveTask(plan.task_id); } catch { /* server fires event */ }
    onDismiss();
  };

  const handleReject = async () => {
    if (acting !== null) return;
    setActing('reject');
    try { await rejectTask(plan.task_id); } catch { /* server fires event */ }
    onDismiss();
  };

  // Countdown
  useEffect(() => {
    if (acting !== null) return;
    const timer = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [acting]);

  // Auto-approve when timer hits 0
  useEffect(() => {
    if (secondsLeft === 0 && !hasAutoApproved.current && acting === null) {
      hasAutoApproved.current = true;
      handleApprove();
    }
  }, [secondsLeft]);

  const progressPct = (secondsLeft / totalSeconds) * 100;
  const timerColor = progressPct > 50 ? 'bg-purple-500' : progressPct > 20 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-600/30 flex items-center justify-center shrink-0 mt-0.5">
              <Zap size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest">{orchestratorName}'s Plan</span>
                <span className="text-xs text-gray-600">·</span>
                <span className="text-xs text-gray-500">{plan.steps.length} steps</span>
              </div>
              <h2 className="text-sm font-semibold text-white leading-snug line-clamp-2">{plan.task}</h2>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold text-white tabular-nums">${plan.total_estimated_cost.toFixed(3)}</div>
              <div className="text-xs text-gray-500">USDC budget</div>
            </div>
          </div>

          {plan.reasoning && (
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">{plan.reasoning}</p>
          )}
        </div>

        {/* Auto-approve bar */}
        <div className="px-5 py-3 bg-gray-950/50 border-b border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <Clock size={10} />
              {acting === null
                ? secondsLeft > 0
                  ? `Auto-approving in ${secondsLeft}s — plan is within your budget`
                  : 'Auto-approving…'
                : acting === 'approve' ? 'Approving plan…' : 'Rejecting plan…'}
            </span>
            <span className="text-xs font-mono text-gray-500 tabular-nums">{secondsLeft}s</span>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${timerColor} rounded-full transition-all duration-1000 ease-linear`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3 space-y-2">
          {plan.steps.map((step, i) => (
            <div key={step.step_id} className="border border-gray-800 rounded-xl overflow-hidden">
              <button
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-800/50 transition-colors"
                onClick={() => setExpanded(expanded === step.step_id ? null : step.step_id)}
              >
                {/* Step number */}
                <div className="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-mono text-gray-400">{i + 1}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-gray-200">{step.agent_name}</span>
                    <span className={`text-xs font-mono px-1.5 py-px rounded border text-xs leading-none ${scoreBg(step.selected_score)}`}>
                      {Math.round(step.selected_score * 100)}
                    </span>
                    {step.alternatives.length > 0 && (
                      <span className="text-xs text-gray-600 hidden sm:block">
                        beat {step.alternatives[0].name} ({Math.round(step.alternatives[0].score * 100)})
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-1 leading-relaxed">{step.action}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-xs font-mono font-semibold text-gray-300">${step.estimated_cost.toFixed(3)}</div>
                    <div className="text-xs text-gray-600 uppercase">{step.payment_method}</div>
                  </div>
                  <ChevronDown
                    size={13}
                    className={`text-gray-600 transition-transform duration-200 ${expanded === step.step_id ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {expanded === step.step_id && (
                <div className="px-4 pb-4 pt-1 bg-gray-950/50 border-t border-gray-800 space-y-4">
                  {step.score_breakdown && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Score Breakdown</p>
                      <ScoreBar value={step.score_breakdown.capability_match} label="Capability match" />
                      <ScoreBar value={step.score_breakdown.reputation} label="Reputation" />
                      <ScoreBar value={step.score_breakdown.price_efficiency} label="Price efficiency" />
                      <ScoreBar value={step.score_breakdown.latency_score} label="Latency" />
                      <ScoreBar value={step.score_breakdown.discovery_bonus} label="Discovery bonus" />
                    </div>
                  )}

                  {step.alternatives.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <TrendingDown size={10} /> Alternatives
                      </p>
                      <div className="space-y-1">
                        {step.alternatives.map(alt => (
                          <div key={alt.agent_id} className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{alt.name}</span>
                            <span className={`text-xs font-mono font-semibold ${scoreColor(alt.score)}`}>
                              {Math.round(alt.score * 100)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={handleReject}
            disabled={acting !== null}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-750 border border-gray-700 text-gray-300 hover:text-white text-sm font-medium transition-all disabled:opacity-40"
          >
            <XCircle size={14} className="text-red-400" />
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={acting !== null}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-all disabled:opacity-40 shadow-lg shadow-purple-900/30"
          >
            <CheckCircle size={14} />
            {acting === 'approve' ? 'Approving…' : `Approve & Run`}
          </button>
        </div>
      </div>
    </div>
  );
}
