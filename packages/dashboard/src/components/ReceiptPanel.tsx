import { Receipt, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

export function ReceiptPanel({ events }: Props) {
  const taskResult = events.find(e => e.event === 'task_result')?.data;
  if (!taskResult) return null;

  const successSteps = taskResult.steps?.filter((s: any) => s.success) ?? [];
  const failedSteps = taskResult.steps?.filter((s: any) => !s.success) ?? [];
  const statusColor = taskResult.status === 'complete' ? 'text-emerald-400' : taskResult.status === 'partial' ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Receipt size={14} className="text-purple-400" />
        <h2 className="text-sm font-semibold text-gray-200">Receipt</h2>
        <span className={`text-xs font-medium ml-auto capitalize ${statusColor}`}>{taskResult.status}</span>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <p className="text-xs text-gray-600">Task ID</p>
            <p className="text-xs text-gray-400 font-mono">{taskResult.task_id?.slice(0, 12)}…</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Duration</p>
            <p className="text-xs text-gray-300 tabular-nums">{(taskResult.total_time_ms / 1000).toFixed(1)}s</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Total Cost</p>
            <p className="text-xs text-emerald-400 font-mono font-semibold">${taskResult.total_cost?.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Steps</p>
            <p className="text-xs">
              <span className="text-emerald-400">{successSteps.length} ok</span>
              {failedSteps.length > 0 && <span className="text-red-400 ml-1">{failedSteps.length} failed</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="divide-y divide-gray-800">
        {(taskResult.steps ?? []).map((step: any) => (
          <div key={step.step_id} className="flex items-center gap-3 px-4 py-2.5">
            {step.success
              ? <CheckCircle size={10} className="text-emerald-500 shrink-0" />
              : <XCircle size={10} className="text-red-500 shrink-0" />}
            <span className="text-xs text-gray-400 flex-1 truncate">{step.agent_name}</span>
            {step.payment?.method && (
              <span className="text-xs text-gray-700 uppercase">{step.payment.method}</span>
            )}
            {step.payment?.amount > 0 && (
              <span className="text-xs font-mono text-gray-300 tabular-nums">${step.payment.amount.toFixed(4)}</span>
            )}
            {step.payment?.tx_hash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${step.payment.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-700 hover:text-blue-400 transition-colors shrink-0"
              >
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Footer total */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-950/30">
        <span className="text-xs font-semibold text-gray-400">Total</span>
        <span className="text-sm font-mono font-bold text-emerald-400">${taskResult.total_cost?.toFixed(4)} USDC</span>
      </div>
    </div>
  );
}
