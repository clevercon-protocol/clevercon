import { TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchAgents } from '../lib/api';

interface AgentRecord {
  agent_id: string;
  name: string;
  pricing: { price_per_call: number; model: string };
  reputation: { total_jobs: number; successful_jobs: number; avg_quality: number; score: number };
}

export function EarningsView() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  useEffect(() => {
    const load = async () => {
      try { setAgents(await fetchAgents()); } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...agents].sort((a, b) => {
    const ea = a.reputation.successful_jobs * a.pricing.price_per_call;
    const eb = b.reputation.successful_jobs * b.pricing.price_per_call;
    return eb - ea;
  });

  const totalEarned = sorted.reduce(
    (sum, a) => sum + a.reputation.successful_jobs * a.pricing.price_per_call, 0
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-400" />
            <h2 className="text-base font-semibold text-gray-200">Agent Earnings</h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Total Earned</div>
            <div className="text-lg font-mono text-emerald-400">${totalEarned.toFixed(4)} USDC</div>
          </div>
        </div>

        <div className="space-y-3">
          {sorted.map(agent => {
            const earned = agent.reputation.successful_jobs * agent.pricing.price_per_call;
            const maxEarned = sorted[0]
              ? sorted[0].reputation.successful_jobs * sorted[0].pricing.price_per_call
              : 1;
            const pct = maxEarned > 0 ? (earned / maxEarned) * 100 : 0;

            return (
              <div key={agent.agent_id} className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-gray-200">{agent.name}</div>
                    <div className="text-xs text-gray-500">
                      {agent.reputation.successful_jobs}/{agent.reputation.total_jobs} jobs ·
                      avg quality {(agent.reputation.avg_quality ?? 0).toFixed(1)}/5 ·
                      rep {(agent.reputation.score ?? 50).toFixed(0)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-emerald-400">${earned.toFixed(4)}</div>
                    <div className="text-xs text-gray-500">${agent.pricing.price_per_call}/call</div>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {agents.length === 0 && (
            <div className="text-xs text-gray-600 py-6 text-center">Loading agent data...</div>
          )}
        </div>
      </div>
    </div>
  );
}
