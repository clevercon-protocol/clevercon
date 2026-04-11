import { useState, useEffect, useCallback } from 'react';
import {
  X, Wallet, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, ChevronDown, Zap, Clock, Pencil, RotateCcw,
} from 'lucide-react';
import type { QueueItem } from './TaskQueue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanStep {
  agent_name: string;
  action: string;
  estimated_cost: number;
  payment_method: string;
}

interface TaskPlan {
  id: string;
  task: string;         // may differ from original if user edited
  budget: number;       // may differ from original if user edited
  delay_ms: number;
  status: 'loading' | 'ready' | 'infeasible' | 'error';
  estimated_cost?: number;
  steps?: PlanStep[];
  reasoning?: string;
  missing?: string[];
  errorMsg?: string;
  selected: boolean;
}

export interface QueueConfirmItem {
  id: string;
  task: string;
  budget: number;
}

interface Props {
  items: QueueItem[];
  vaultAvailable: number | null;
  orchestratorName: string;
  onFundVault: () => void;
  onConfirm: (confirmed: QueueConfirmItem[]) => void;
  onClose: () => void;
}

const BUDGET_CHIPS = [0.10, 0.25, 0.50, 1.00];

function fmtDelay(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)} min`;
}

async function fetchPreview(task: string, budget: number) {
  const res = await fetch('/api/tasks/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, budget }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QueueReviewModal({
  items, vaultAvailable, orchestratorName, onFundVault, onConfirm, onClose,
}: Props) {
  const [plans, setPlans] = useState<TaskPlan[]>(() =>
    items.map(i => ({
      id: i.id, task: i.task, budget: i.budget, delay_ms: i.delay_ms,
      status: 'loading', selected: true,
    }))
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // edit draft state
  const [editTask, setEditTask] = useState('');
  const [editBudget, setEditBudget] = useState(0.25);

  // Load a plan for one item
  const loadPlan = useCallback((id: string, task: string, budget: number) => {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, status: 'loading', steps: undefined, estimated_cost: undefined } : p));
    fetchPreview(task, budget)
      .then(result => {
        setPlans(prev => prev.map(p => {
          if (p.id !== id) return p;
          if (result.error) return { ...p, status: 'error', errorMsg: result.message ?? result.error };
          if (!result.feasible) return { ...p, status: 'infeasible', missing: result.missing, errorMsg: result.message };
          return { ...p, status: 'ready', estimated_cost: result.total_estimated_cost, steps: result.steps, reasoning: result.reasoning };
        }));
      })
      .catch(err => {
        setPlans(prev => prev.map(p => p.id === id ? { ...p, status: 'error', errorMsg: err.message ?? 'Preview failed' } : p));
      });
  }, []);

  // Fetch all plans on mount
  useEffect(() => {
    items.forEach(i => loadPlan(i.id, i.task, i.budget));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (plan: TaskPlan) => {
    setEditing(plan.id);
    setEditTask(plan.task);
    setEditBudget(plan.budget);
    setExpanded(null);
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = (id: string) => {
    const trimmed = editTask.trim();
    if (!trimmed) return;
    setPlans(prev => prev.map(p => p.id === id ? { ...p, task: trimmed, budget: editBudget } : p));
    setEditing(null);
    loadPlan(id, trimmed, editBudget);
  };

  const toggleSelect = (id: string) =>
    setPlans(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));

  const selectedPlans = plans.filter(p => p.selected);
  const allLoaded = plans.every(p => p.status !== 'loading');

  const totalRequired = selectedPlans.reduce((sum, p) =>
    sum + (p.status === 'ready' && p.estimated_cost !== undefined ? p.estimated_cost : p.budget), 0
  );

  const hasInsufficient = vaultAvailable !== null && totalRequired > vaultAvailable;
  const shortfall = vaultAvailable !== null ? Math.max(0, totalRequired - vaultAvailable) : 0;
  const hasInfeasible = selectedPlans.some(p => p.status === 'infeasible');
  const canConfirm = allLoaded && selectedPlans.length > 0 && !hasInsufficient && !hasInfeasible && editing === null;

  const handleConfirm = () => {
    onConfirm(selectedPlans.map(p => ({ id: p.id, task: p.task, budget: p.budget })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-600/30 flex items-center justify-center shrink-0 mt-0.5">
              <Zap size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-1">
                {orchestratorName} · Queue Review
              </p>
              <p className="text-sm text-gray-300">
                {plans.length} task{plans.length !== 1 ? 's' : ''} to run in sequence
              </p>
            </div>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Balance summary */}
        <div className="px-5 py-3 bg-gray-950/50 border-b border-gray-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Vault balance</span>
            <span className="font-mono font-semibold text-gray-300">
              {vaultAvailable !== null ? `$${vaultAvailable.toFixed(4)} USDC` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Selected total {!allLoaded && <span className="text-gray-700 ml-1">(loading…)</span>}
            </span>
            <span className={`font-mono font-semibold ${hasInsufficient ? 'text-amber-400' : 'text-white'}`}>
              ~${totalRequired.toFixed(4)} USDC
            </span>
          </div>
          {hasInsufficient && (
            <div className="flex items-center justify-between text-xs border-t border-gray-800 pt-2">
              <span className="text-amber-400">Deposit needed</span>
              <span className="text-amber-400 font-mono font-semibold">${shortfall.toFixed(4)} USDC</span>
            </div>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3 space-y-2">
          {plans.map((plan, idx) => {
            const isEditing = editing === plan.id;

            return (
              <div key={plan.id}>
                {/* Delay connector */}
                {idx > 0 && (
                  <div className="flex items-center gap-2 py-1 pl-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-px h-3 bg-gray-700" />
                      <div className="w-px h-3 bg-gray-700" />
                    </div>
                    <Clock size={9} className="text-gray-700" />
                    <span className="text-xs text-gray-700 font-mono">+{fmtDelay(plan.delay_ms)} after previous</span>
                  </div>
                )}

                <div className={`border rounded-xl overflow-hidden transition-colors ${
                  isEditing                    ? 'border-purple-700/60' :
                  !plan.selected               ? 'border-gray-800 opacity-50' :
                  plan.status === 'infeasible' ? 'border-red-900/60' :
                  plan.status === 'error'      ? 'border-red-900/40' :
                  hasInsufficient              ? 'border-amber-900/40' :
                  'border-gray-700'
                }`}>

                  {isEditing ? (
                    /* ── Edit mode ── */
                    <div className="px-4 py-3 space-y-3">
                      <p className="text-xs text-purple-400 font-medium uppercase tracking-wider">Edit task</p>

                      <textarea
                        rows={3}
                        value={editTask}
                        onChange={e => setEditTask(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/70 rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 resize-none outline-none transition-colors"
                        autoFocus
                      />

                      <div>
                        <p className="text-xs text-gray-600 mb-1.5">Budget</p>
                        <div className="grid grid-cols-4 gap-1 mb-1.5">
                          {BUDGET_CHIPS.map(q => (
                            <button
                              key={q}
                              onClick={() => setEditBudget(q)}
                              className={`text-xs py-1.5 rounded-lg border transition-all font-mono ${
                                editBudget === q
                                  ? 'bg-purple-600/30 border-purple-600/60 text-purple-300'
                                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                              }`}
                            >
                              ${q.toFixed(2)}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={editBudget}
                            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setEditBudget(v); }}
                            className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg pl-5 pr-3 py-1.5 text-xs font-mono font-semibold text-purple-300 outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                        >
                          <RotateCcw size={10} />
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(plan.id)}
                          disabled={!editTask.trim()}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-medium transition-colors"
                        >
                          <CheckCircle size={10} />
                          Save & Replan
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── View mode ── */
                    <>
                      <div className="flex items-start gap-3 px-4 py-3">
                        {/* Checkbox */}
                        <button
                          onClick={() => toggleSelect(plan.id)}
                          className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            plan.selected ? 'bg-purple-600 border-purple-600' : 'border-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {plan.selected && <CheckCircle size={10} className="text-white" />}
                        </button>

                        {/* Task text + meta */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-200 leading-relaxed">{plan.task}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className="text-xs font-mono text-gray-600">${plan.budget.toFixed(2)} budget</span>

                            {plan.status === 'loading' && (
                              <span className="flex items-center gap-1 text-xs text-gray-600">
                                <RefreshCw size={9} className="animate-spin" />
                                planning…
                              </span>
                            )}
                            {plan.status === 'ready' && plan.estimated_cost !== undefined && (
                              <span className={`flex items-center gap-1 text-xs font-mono font-semibold ${
                                plan.estimated_cost > plan.budget ? 'text-amber-400' : 'text-emerald-400'
                              }`}>
                                ~${plan.estimated_cost.toFixed(4)} est.
                                {plan.estimated_cost > plan.budget && <AlertTriangle size={9} />}
                              </span>
                            )}
                            {plan.status === 'infeasible' && (
                              <span className="flex items-center gap-1 text-xs text-red-500">
                                <XCircle size={9} />
                                infeasible
                              </span>
                            )}
                            {plan.status === 'error' && (
                              <span className="flex items-center gap-1 text-xs text-red-500">
                                <AlertTriangle size={9} />
                                preview failed
                              </span>
                            )}
                          </div>

                          {plan.status === 'infeasible' && (
                            <p className="text-xs text-red-500 mt-1">{plan.errorMsg ?? `Missing: ${plan.missing?.join(', ')}`}</p>
                          )}
                          {plan.status === 'error' && (
                            <p className="text-xs text-red-500/70 mt-1">{plan.errorMsg}</p>
                          )}
                          {plan.status === 'ready' && plan.reasoning && (
                            <p className="text-xs text-gray-600 mt-1 italic">{plan.reasoning}</p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Edit */}
                          <button
                            onClick={() => startEdit(plan)}
                            className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
                            title="Edit task"
                          >
                            <Pencil size={11} />
                          </button>

                          {/* Re-fetch plan */}
                          {(plan.status === 'error' || plan.status === 'infeasible') && (
                            <button
                              onClick={() => loadPlan(plan.id, plan.task, plan.budget)}
                              className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
                              title="Retry preview"
                            >
                              <RotateCcw size={11} />
                            </button>
                          )}

                          {/* Expand steps */}
                          {plan.status === 'ready' && plan.steps && plan.steps.length > 0 && (
                            <button
                              onClick={() => setExpanded(expanded === plan.id ? null : plan.id)}
                              className="p-1 text-gray-600 hover:text-gray-400 transition-colors"
                            >
                              <ChevronDown size={13} className={`transition-transform duration-200 ${expanded === plan.id ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Step breakdown */}
                      {expanded === plan.id && plan.steps && (
                        <div className="px-4 pb-3 pt-1 border-t border-gray-800 bg-gray-950/40 space-y-1.5">
                          {plan.steps.map((step, si) => (
                            <div key={si} className="flex items-start gap-2">
                              <span className="w-4 h-4 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-xs font-mono text-gray-500">{si + 1}</span>
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-gray-300">{step.agent_name}</span>
                                <span className="text-xs text-gray-600 ml-1">· {step.action}</span>
                              </div>
                              <span className="text-xs font-mono text-gray-500 shrink-0">${step.estimated_cost.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-gray-800 space-y-3">
          {hasInsufficient && (
            <button
              onClick={onFundVault}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-700/50 text-amber-300 text-sm font-medium transition-all"
            >
              <Wallet size={14} />
              Fund Vault (need ${shortfall.toFixed(4)} more)
            </button>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-lg shadow-purple-900/30"
            >
              <Zap size={14} />
              {editing !== null
                ? 'Finish editing first'
                : hasInfeasible
                  ? 'Deselect infeasible tasks first'
                  : hasInsufficient
                    ? 'Insufficient balance'
                    : `Run ${selectedPlans.length} Task${selectedPlans.length !== 1 ? 's' : ''} in Sequence`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
