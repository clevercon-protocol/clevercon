import { useEffect, useState } from 'react';
import { History, ExternalLink, CheckCircle, XCircle, Zap, ArrowUpRight, Lock, RefreshCw } from 'lucide-react';
import { fetchActivity } from '../lib/api';
import { useWallet } from '../contexts/WalletProvider';

interface ActivityEvent {
  id: string;
  event: string;
  task_id: string;
  task_description?: string;
  amount_usdc?: number;
  agent_name?: string;
  tx_hash?: string;
  vault_task_id?: number;
  timestamp: string;
}

const EVENT_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  task_started:     { label: 'Task Started',      icon: Zap,           color: 'text-purple-400' },
  budget_locked:    { label: 'Budget Locked',      icon: Lock,          color: 'text-amber-400' },
  payment_released: { label: 'Payment Released',   icon: ArrowUpRight,  color: 'text-blue-400' },
  task_completed:   { label: 'Task Completed',     icon: CheckCircle,   color: 'text-emerald-400' },
  task_failed:      { label: 'Task Failed',        icon: XCircle,       color: 'text-red-400' },
  task_cancelled:   { label: 'Task Cancelled',     icon: XCircle,       color: 'text-gray-500' },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function OrchestratorActivity() {
  const { publicKey } = useWallet();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    if (!publicKey) return;
    fetchActivity(publicKey)
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!publicKey) return;
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [publicKey]);

  if (!publicKey) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <History size={14} className="text-purple-400" />
        <h2 className="text-sm font-semibold text-gray-200">Activity</h2>
        <button
          onClick={refresh}
          className="ml-auto text-gray-600 hover:text-gray-400 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-600">
          <RefreshCw size={11} className="animate-spin" />
          Loading…
        </div>
      ) : events.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-gray-600">
          No activity yet — run your first task.
        </div>
      ) : (
        <div className="divide-y divide-gray-800/60 max-h-[600px] overflow-y-auto">
          {events.map(ev => {
            const cfg = EVENT_CONFIG[ev.event] ?? { label: ev.event, icon: History, color: 'text-gray-500' };
            const Icon = cfg.icon;
            return (
              <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                  <Icon size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    {ev.amount_usdc != null && ev.amount_usdc > 0 && (
                      <span className="text-xs font-mono text-gray-400">${ev.amount_usdc.toFixed(4)}</span>
                    )}
                  </div>
                  {ev.task_description && (
                    <p className="text-xs text-gray-600 truncate mt-px">{ev.task_description}</p>
                  )}
                  {ev.agent_name && (
                    <p className="text-xs text-gray-600 mt-px">→ {ev.agent_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-gray-700 tabular-nums">{timeAgo(ev.timestamp)}</span>
                  {ev.tx_hash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${ev.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-blue-400 transition-colors"
                    >
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
