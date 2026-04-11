import { useEffect, useState } from 'react';
import { Activity, CheckCircle, TrendingUp, Star, DollarSign } from 'lucide-react';
import { fetchPulse } from '../lib/api';

interface PulseStats {
  total_tasks: number;
  total_completed: number;
  total_failed: number;
  active_tasks: number;
  total_spent_usdc: number;
  most_hired_agent: string | null;
  recent_completions: Array<{
    task_description: string;
    amount_usdc: number;
    timestamp: string;
  }>;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function MarketplacePulse() {
  const [pulse, setPulse] = useState<PulseStats | null>(null);

  useEffect(() => {
    const fetch = () => fetchPulse().then(setPulse).catch(() => {});
    fetch();
    const t = setInterval(fetch, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!pulse || pulse.total_tasks === 0) return null;

  const successRate = pulse.total_tasks > 0
    ? Math.round((pulse.total_completed / pulse.total_tasks) * 100)
    : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Activity size={14} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-gray-200">Marketplace Pulse</h2>
        {pulse.active_tasks > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {pulse.active_tasks} live
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-800">
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp size={10} className="text-gray-600" />
            <p className="text-xs text-gray-600">Total Tasks</p>
          </div>
          <p className="text-lg font-mono font-bold text-white">{pulse.total_tasks}</p>
        </div>
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <CheckCircle size={10} className="text-gray-600" />
            <p className="text-xs text-gray-600">Success Rate</p>
          </div>
          <p className={`text-lg font-mono font-bold ${successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {successRate}%
          </p>
        </div>
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <DollarSign size={10} className="text-gray-600" />
            <p className="text-xs text-gray-600">Total Spent</p>
          </div>
          <p className="text-lg font-mono font-bold text-emerald-400">${pulse.total_spent_usdc.toFixed(3)}</p>
        </div>
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Star size={10} className="text-gray-600" />
            <p className="text-xs text-gray-600">Top Agent</p>
          </div>
          <p className="text-sm font-semibold text-purple-400 truncate">{pulse.most_hired_agent ?? '—'}</p>
        </div>
      </div>

      {/* Recent completions */}
      {pulse.recent_completions.length > 0 && (
        <div>
          <p className="px-4 pt-3 pb-1.5 text-xs font-medium text-gray-600 uppercase tracking-wider">Recent</p>
          <div className="divide-y divide-gray-800/60">
            {pulse.recent_completions.map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2">
                <CheckCircle size={10} className="text-emerald-500 shrink-0" />
                <span className="text-xs text-gray-400 flex-1 truncate">{c.task_description}</span>
                <span className="text-xs font-mono text-emerald-400 shrink-0">${c.amount_usdc.toFixed(3)}</span>
                <span className="text-xs text-gray-700 shrink-0">{timeAgo(c.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
