import { Shield, ExternalLink, CheckCircle, ArrowDownLeft, Lock, Coins } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

const VAULT_CONTRACT_ID = 'CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE';
const EXPLORER_URL = `https://stellar.expert/explorer/testnet/contract/${VAULT_CONTRACT_ID}`;

interface VaultState {
  vault_task_id: number | null;
  plan_cost_usdc: number;
  spent_usdc: number;
  releases: Array<{ agent_name: string; amount: number; tx_hash: string }>;
  completed: boolean;
  refund_usdc: number;
}

function extractVaultState(events: WSEvent[]): VaultState | null {
  const locked = events.find(e => e.event === 'budget_locked');
  if (!locked) return null;

  const releases = events
    .filter(e => e.event === 'budget_released')
    .map(e => ({
      agent_name: e.data?.agent_name ?? '',
      amount: e.data?.amount ?? 0,
      tx_hash: e.data?.tx_hash ?? '',
    }));

  const finalized = events.find(e => e.event === 'budget_finalized');
  const spent = finalized?.data?.total_spent ?? releases.reduce((s, r) => s + r.amount, 0);

  return {
    vault_task_id: locked.data?.contract_task_id ?? null,
    plan_cost_usdc: locked.data?.budget_usdc ?? 0,
    spent_usdc: spent,
    releases,
    completed: !!finalized,
    refund_usdc: finalized?.data?.refund_usdc ?? 0,
  };
}

export function VaultActivity({ events }: Props) {
  const state = extractVaultState(events);

  if (!state) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={14} className="text-gray-600" />
          <h2 className="text-sm font-semibold text-gray-500">Vault Activity</h2>
          <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="ml-auto text-gray-700 hover:text-gray-500 transition-colors">
            <ExternalLink size={10} />
          </a>
        </div>
        <p className="text-xs text-gray-700 text-center py-3">No active task</p>
      </div>
    );
  }

  const pctSpent = state.plan_cost_usdc > 0
    ? Math.min(100, (state.spent_usdc / state.plan_cost_usdc) * 100)
    : 0;

  const barColor = pctSpent >= 90 ? 'bg-red-500' : pctSpent >= 70 ? 'bg-amber-500' : 'bg-purple-500';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className={state.completed ? 'text-gray-500' : 'text-purple-400'} />
        <h2 className="text-sm font-semibold text-gray-200">Vault Activity</h2>
        {state.vault_task_id !== null && (
          <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-md">#{state.vault_task_id}</span>
        )}
        <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="ml-auto text-gray-700 hover:text-gray-400 transition-colors">
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Lock status */}
      <div className="flex items-center gap-1.5 text-xs mb-3">
        {state.completed ? (
          <span className="text-gray-600">finalized</span>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-950/40 border border-amber-900/40">
            <Lock size={9} className="text-amber-400" />
            <span className="text-amber-400 font-mono">${state.plan_cost_usdc.toFixed(4)} locked</span>
          </div>
        )}
      </div>

      {/* Spend bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-gray-400 font-mono">${state.spent_usdc.toFixed(4)} released</span>
          <span className="text-gray-600 font-mono">of ${state.plan_cost_usdc.toFixed(4)}</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-700`}
            style={{ width: `${pctSpent}%` }}
          />
        </div>
      </div>

      {/* Per-step releases */}
      {state.releases.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {state.releases.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-gray-800/50 rounded-lg px-2.5 py-1.5">
              <ArrowDownLeft size={10} className="text-purple-400 shrink-0" />
              <span className="text-gray-400 truncate">{r.agent_name}</span>
              <span className="text-purple-300 font-mono ml-auto shrink-0">${r.amount.toFixed(4)}</span>
              {r.tx_hash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${r.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-700 hover:text-blue-400 transition-colors shrink-0"
                >
                  <ExternalLink size={9} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Finalized */}
      {state.completed && (
        <div className="pt-2.5 border-t border-gray-800 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle size={11} />
            <span>Finalized on-chain</span>
          </div>
          {state.refund_usdc > 0.000001 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 pl-4">
              <Coins size={9} />
              <span>${state.refund_usdc.toFixed(4)} refunded to vault</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
