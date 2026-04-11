import { useEffect, useRef } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Zap, Star, Shield, ChevronRight, ExternalLink } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
  connected: boolean;
  onClear: () => void;
  orchestratorName?: string;
}

type EventMeta = { icon: React.ReactNode; color: string; bg: string };

const EVENT_META: Record<string, EventMeta> = {
  task_accepted:           { icon: <Zap size={11} />,          color: 'text-purple-400',  bg: 'bg-purple-950/60 border-purple-900/60' },
  agents_loaded:           { icon: <Activity size={11} />,     color: 'text-blue-400',    bg: 'bg-blue-950/60 border-blue-900/60' },
  agents_scored:           { icon: <Star size={11} />,         color: 'text-violet-400',  bg: 'bg-violet-950/60 border-violet-900/60' },
  feasibility_checked:     { icon: <ChevronRight size={11} />, color: 'text-gray-400',    bg: 'bg-gray-800/60 border-gray-700/60' },
  plan_created:            { icon: <ChevronRight size={11} />, color: 'text-blue-400',    bg: 'bg-blue-950/60 border-blue-900/60' },
  plan_validated:          { icon: <CheckCircle size={11} />,  color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  plan_approval_required:  { icon: <Clock size={11} />,        color: 'text-amber-400',   bg: 'bg-amber-950/60 border-amber-900/60' },
  plan_approved:           { icon: <CheckCircle size={11} />,  color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  plan_rejected:           { icon: <XCircle size={11} />,      color: 'text-red-400',     bg: 'bg-red-950/60 border-red-900/60' },
  plan_auto_approved:      { icon: <CheckCircle size={11} />,  color: 'text-gray-400',    bg: 'bg-gray-800/60 border-gray-700/60' },
  budget_locked:           { icon: <Shield size={11} />,       color: 'text-purple-400',  bg: 'bg-purple-950/60 border-purple-900/60' },
  budget_released:         { icon: <Shield size={11} />,       color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  budget_approved:         { icon: <Shield size={11} />,       color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  budget_denied:           { icon: <Shield size={11} />,       color: 'text-red-400',     bg: 'bg-red-950/60 border-red-900/60' },
  budget_finalized:        { icon: <Shield size={11} />,       color: 'text-gray-400',    bg: 'bg-gray-800/60 border-gray-700/60' },
  task_started:            { icon: <Zap size={11} />,          color: 'text-amber-400',   bg: 'bg-amber-950/60 border-amber-900/60' },
  step_started:            { icon: <Clock size={11} />,        color: 'text-amber-400',   bg: 'bg-amber-950/60 border-amber-900/60' },
  step_complete:           { icon: <CheckCircle size={11} />,  color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  step_failed:             { icon: <XCircle size={11} />,      color: 'text-red-400',     bg: 'bg-red-950/60 border-red-900/60' },
  task_complete:           { icon: <CheckCircle size={11} />,  color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  task_result:             { icon: <CheckCircle size={11} />,  color: 'text-emerald-400', bg: 'bg-emerald-950/60 border-emerald-900/60' },
  task_error:              { icon: <XCircle size={11} />,      color: 'text-red-400',     bg: 'bg-red-950/60 border-red-900/60' },
  task_infeasible:         { icon: <XCircle size={11} />,      color: 'text-orange-400',  bg: 'bg-orange-950/60 border-orange-900/60' },
};

function formatLabel(event: string, orchestratorName: string): string {
  const map: Record<string, string> = {
    task_accepted: 'Task Accepted',
    agents_loaded: 'Agents Loaded',
    agents_scored: 'Agents Scored',
    feasibility_checked: 'Feasibility Checked',
    plan_created: `${orchestratorName} Created Plan`,
    plan_validated: 'Plan Validated',
    plan_approval_required: 'Plan Approval Required',
    plan_approved: 'Plan Approved',
    plan_rejected: 'Plan Rejected',
    plan_auto_approved: 'Auto-Approved',
    budget_locked: 'Budget Locked',
    budget_released: 'Budget Released',
    budget_approved: 'Budget Approved',
    budget_denied: 'Budget Denied',
    budget_finalized: 'Budget Finalized',
    task_started: `${orchestratorName} Started`,
    step_started: 'Step Started',
    step_complete: 'Step Complete',
    step_failed: 'Step Failed',
    task_complete: 'Task Complete',
    task_result: 'Task Result',
    task_error: 'Task Error',
    task_infeasible: 'Task Infeasible',
  };
  return map[event] ?? event.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface ParsedDetail {
  text: string;
  txHash?: string;
}

function formatDetail(event: string, data: any, orchestratorName: string): ParsedDetail {
  if (!data) return { text: '' };

  switch (event) {
    case 'agents_loaded':
      return { text: `${data.count ?? 0} agents available` };
    case 'agents_scored':
      return { text: `${data.agents?.length ?? 0} scored · top: ${data.agents?.[0]?.name ?? '?'} (${data.agents?.[0]?.score ?? 0})` };
    case 'feasibility_checked':
      return { text: `${data.feasible ? 'Feasible' : 'Infeasible'} · [${data.needed?.slice(0, 3).join(', ')}${(data.needed?.length ?? 0) > 3 ? '…' : ''}]` };
    case 'plan_created': {
      const sels: string[] = (data.step_selections ?? [])
        .filter((s: any) => s.alternatives?.length > 0)
        .slice(0, 1)
        .map((s: any) => `${s.agent_name} (${Math.round(s.selected_score * 100)}) over ${s.alternatives[0].name} (${Math.round(s.alternatives[0].score * 100)})`);
      return { text: `${data.steps} steps · $${data.total_estimated_cost?.toFixed(3)}${sels.length ? ' · ' + sels[0] : ''}` };
    }
    case 'plan_approval_required':
      return { text: `${data.steps?.length ?? 0} steps · $${data.total_estimated_cost?.toFixed(3)} — awaiting approval` };
    case 'plan_approved':
      return { text: `${orchestratorName} is executing` };
    case 'plan_auto_approved':
      return { text: 'Approved automatically — within budget' };
    case 'plan_rejected':
      return { text: 'Plan was rejected' };
    case 'budget_locked':
      return { text: `task #${data.contract_task_id} · $${data.budget_usdc?.toFixed(2)} locked on-chain` };
    case 'budget_released':
      return { text: `${data.agent_name} · $${data.amount?.toFixed(4)} released`, txHash: data.tx_hash };
    case 'budget_approved':
      return { text: `${data.agent_name} · $${data.amount?.toFixed(3)} approved` };
    case 'budget_denied':
      return { text: `${data.agent_name} · $${data.amount?.toFixed(3)} denied — over budget` };
    case 'budget_finalized':
      return { text: `task #${data.contract_task_id} · $${data.total_spent?.toFixed(4)} spent` };
    case 'task_started':
      return { text: `${data.step_count ?? 0} steps planned` };
    case 'step_started':
      return { text: `${data.agent_name}: ${(data.action ?? '').slice(0, 80)}` };
    case 'step_complete': {
      const ms = data.latency_ms ? ` · ${data.latency_ms}ms` : '';
      return { text: `${data.agent_name}${ms}`, txHash: data.tx_hash };
    }
    case 'step_failed':
      return { text: `${data.agent_name}: ${(data.error ?? '').slice(0, 80)}` };
    case 'task_complete':
      return { text: `${data.status} · $${data.total_cost?.toFixed(4)} · ${(data.total_time_ms / 1000).toFixed(1)}s` };
    case 'task_result':
      return { text: `${data.status} · $${data.total_cost?.toFixed(4)} · ${(data.total_time_ms / 1000).toFixed(1)}s` };
    case 'task_error':
      return { text: (data.error ?? '').slice(0, 100) };
    default:
      return { text: JSON.stringify(data).slice(0, 80) };
  }
}

export function ActivityFeed({ events, connected, onClear, orchestratorName = 'Agent' }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity size={14} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-200">Activity Feed</h2>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-xs text-gray-600">{connected ? 'live' : 'reconnecting…'}</span>
          </div>
        </div>
        {events.length > 0 && (
          <button onClick={onClear} className="text-xs text-gray-600 hover:text-gray-400 transition-colors px-2 py-1 rounded-lg hover:bg-gray-800">
            Clear
          </button>
        )}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-1">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
              <Activity size={18} className="text-gray-600" />
            </div>
            <p className="text-xs text-gray-600 text-center">
              Submit a task to see {orchestratorName} in action
            </p>
          </div>
        ) : (
          [...events].reverse().map((e, i) => {
            const meta = EVENT_META[e.event] ?? { icon: <Activity size={11} />, color: 'text-gray-500', bg: 'bg-gray-800/60 border-gray-700/60' };
            const label = formatLabel(e.event, orchestratorName);
            const { text: detail, txHash } = formatDetail(e.event, e.data, orchestratorName);
            const time = new Date(e.timestamp).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return (
              <div key={i} className={`flex items-start gap-2.5 px-2.5 py-2 rounded-xl border ${meta.bg} transition-all`}>
                <span className={`mt-0.5 shrink-0 ${meta.color}`}>{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-semibold ${meta.color}`}>{label}</span>
                    <span className="text-xs text-gray-700 font-mono shrink-0 tabular-nums">{time}</span>
                  </div>
                  {(detail || txHash) && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {detail && <p className="text-xs text-gray-500 truncate leading-relaxed">{detail}</p>}
                      {txHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-gray-600 hover:text-blue-400 transition-colors"
                          title="View transaction"
                        >
                          <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
