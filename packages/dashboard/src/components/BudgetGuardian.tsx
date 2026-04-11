import { Shield, ExternalLink, CheckCircle, XCircle, Lock } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

interface BudgetState {
  contract_task_id: number | null;
  budget_usdc: number;
  spent_usdc: number;
  num_payments: number;
  completed: boolean;
  contract_id: string | null;
  explorer_url: string | null;
}

function extractBudgetState(events: WSEvent[]): BudgetState | null {
  const locked = events.find(e => e.event === 'budget_locked');
  if (!locked) return null;

  // budget_released (U5) supersedes budget_approved (Phase 12 — kept for compat)
  const approvals = events.filter(e => e.event === 'budget_released' || e.event === 'budget_approved');
  const finalized = events.find(e => e.event === 'budget_finalized');
  const taskResult = events.find(e => e.event === 'task_result');

  const spent = approvals.reduce((sum, e) => sum + (e.data?.amount ?? 0), 0);

  return {
    contract_task_id: locked.data?.contract_task_id ?? null,
    budget_usdc: locked.data?.budget_usdc ?? 0,
    spent_usdc: finalized?.data?.total_spent ?? taskResult?.data?.total_cost ?? spent,
    num_payments: approvals.length,
    completed: !!finalized,
    contract_id: locked.data?.contract_id ?? null,
    explorer_url: locked.data?.explorer_url ?? null,
  };
}

export function BudgetGuardian({ events }: Props) {
  const budget = extractBudgetState(events);

  // Check for denied payment
  const denied = events.find(e => e.event === 'budget_denied');

  // No budget activity yet — show inactive state
  if (!budget) {
    const hasContractActivity = events.some(e =>
      ['budget_locked', 'budget_approved', 'budget_denied', 'budget_finalized'].includes(e.event)
    );

    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-400">Budget Guardian</h2>
          <span className="text-xs text-gray-600 ml-auto">Soroban</span>
        </div>
        <div className="text-xs text-gray-600 text-center py-3">
          {hasContractActivity
            ? 'Loading contract state...'
            : 'On-chain budget tracking not active.\nDeploy contract and set BUDGET_CONTRACT_ID.'}
        </div>
      </div>
    );
  }

  const pctSpent = budget.budget_usdc > 0
    ? Math.min(100, (budget.spent_usdc / budget.budget_usdc) * 100)
    : 0;

  const barColor = pctSpent >= 90
    ? 'bg-red-500'
    : pctSpent >= 70
    ? 'bg-yellow-500'
    : 'bg-green-500';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield size={16} className={budget.completed ? 'text-gray-400' : 'text-purple-400'} />
        <h2 className="text-sm font-semibold text-gray-200">Budget Guardian</h2>
        {budget.completed ? (
          <span className="text-xs text-gray-500 ml-auto">finalized</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
            <Lock size={10} /> locked
          </span>
        )}
      </div>

      {/* Contract task ID */}
      {budget.contract_task_id !== null && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500">Task #{budget.contract_task_id}</span>
          {budget.explorer_url && (
            <a
              href={budget.explorer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              Contract <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}

      {/* Budget bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-400">${budget.spent_usdc.toFixed(4)} spent</span>
          <span className="text-gray-500">of ${budget.budget_usdc.toFixed(2)}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pctSpent}%` }}
          />
        </div>
        <div className="text-xs text-gray-600 mt-0.5 text-right">
          ${(budget.budget_usdc - budget.spent_usdc).toFixed(4)} remaining
        </div>
      </div>

      {/* Payment approvals */}
      <div className="space-y-1 mt-2">
        {events
          .filter(e => e.event === 'budget_released' || e.event === 'budget_approved')
          .map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <CheckCircle size={11} className="text-green-400 shrink-0" />
              <span className="text-gray-400 truncate">{e.data?.agent_name}</span>
              <span className="text-gray-500 ml-auto shrink-0">${e.data?.amount?.toFixed(3)}</span>
            </div>
          ))}

        {denied && (
          <div className="flex items-center gap-2 text-xs">
            <XCircle size={11} className="text-red-400 shrink-0" />
            <span className="text-red-400 truncate">{denied.data?.agent_name} denied</span>
            <span className="text-gray-500 ml-auto shrink-0">${denied.data?.amount?.toFixed(3)}</span>
          </div>
        )}
      </div>

      {/* Finalized state */}
      {budget.completed && (
        <div className="mt-3 pt-2 border-t border-gray-800 space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle size={12} className="text-green-400" />
            <span className="text-xs text-green-400">Finalized on-chain</span>
          </div>
          {(() => {
            const fin = events.find(e => e.event === 'budget_finalized');
            const refund = fin?.data?.refund_usdc ?? 0;
            return refund > 0 ? (
              <div className="text-xs text-gray-500 pl-4">
                ${refund.toFixed(4)} refunded to vault
              </div>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
