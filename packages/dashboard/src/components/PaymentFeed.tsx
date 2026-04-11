import { ExternalLink, ArrowRight } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

interface Payment {
  step: number;
  agent: string;
  tx_hash: string;
  method: string;
  amount?: number;
}

export function PaymentFeed({ events }: Props) {
  const stepPayments: Payment[] = events
    .filter(e => e.event === 'step_complete' && e.data?.tx_hash)
    .map(e => ({
      step: e.data.step_id,
      agent: e.data.agent_name,
      tx_hash: e.data.tx_hash,
      method: 'x402',
    }));

  // Prefer detailed payments from task_result
  const taskResult = events.find(e => e.event === 'task_result')?.data;
  const detailedPayments: Payment[] = (taskResult?.steps ?? [])
    .filter((s: any) => s.payment?.tx_hash)
    .map((s: any) => ({
      step: s.step_id,
      agent: s.agent_name,
      tx_hash: s.payment.tx_hash,
      method: s.payment.method,
      amount: s.payment.amount,
    }));

  const payments = detailedPayments.length > 0 ? detailedPayments : stepPayments;

  if (payments.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <ArrowRight size={14} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-gray-200">On-Chain Payments</h2>
        <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-md ml-auto">{payments.length}</span>
      </div>

      <div className="divide-y divide-gray-800 max-h-40 overflow-y-auto">
        {payments.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-300 truncate">{p.agent}</span>
                <span className={`text-xs px-1.5 py-px rounded border leading-none font-medium uppercase ${
                  p.method === 'x402'
                    ? 'bg-blue-950/60 border-blue-900/60 text-blue-400'
                    : 'bg-violet-950/60 border-violet-900/60 text-violet-400'
                }`}>{p.method}</span>
              </div>
              <p className="text-xs text-gray-700 font-mono mt-0.5">{p.tx_hash.slice(0, 12)}…</p>
            </div>
            {p.amount && (
              <span className="text-xs font-mono font-semibold text-emerald-400 shrink-0">${p.amount.toFixed(3)}</span>
            )}
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${p.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 hover:text-blue-400 transition-colors shrink-0"
            >
              <ExternalLink size={11} />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
