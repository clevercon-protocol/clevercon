import { useEffect, useState } from 'react';
import { Bot, Star, RefreshCw, Trash2, Zap } from 'lucide-react';
import { fetchAgents } from '../lib/api';

interface AgentRecord {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: { model: string; price_per_call: number; currency: string };
  status: string;
  reputation: {
    score: number;
    total_jobs: number;
    successful_jobs: number;
    avg_quality: number;
    avg_latency_ms: number;
  };
}

const CORE_AGENTS = new Set(['stellar-oracle', 'web-intel-v1', 'web-intel-v2', 'analysis-agent', 'reporter-agent']);

function scoreStyle(score: number): string {
  if (score >= 80) return 'text-emerald-400 bg-emerald-950/60 border-emerald-900';
  if (score >= 50) return 'text-amber-400 bg-amber-950/60 border-amber-900';
  return 'text-red-400 bg-red-950/60 border-red-900';
}

function modelBadge(model: string) {
  return model === 'x402'
    ? 'bg-blue-950/60 border-blue-900/60 text-blue-400'
    : 'bg-violet-950/60 border-violet-900/60 text-violet-400';
}

export function AgentPanel() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setAgents(await fetchAgents()); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const removeAgent = async (agent_id: string) => {
    setDeleting(agent_id);
    setConfirmId(null);
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent_id)}`, { method: 'DELETE' });
      if (r.ok) setAgents(prev => prev.filter(a => a.agent_id !== agent_id));
    } catch { /* ignore */ }
    setDeleting(null);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-gray-200">Marketplace</h2>
          <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-md">{agents.length}</span>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded-lg text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-all"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {agents.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-gray-600">{loading ? 'Loading agents…' : 'No agents registered'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {agents.map(agent => (
              <div key={agent.agent_id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-gray-200">{agent.name}</span>
                      <span className={`text-xs font-mono px-1.5 py-px rounded border leading-none ${scoreStyle(agent.reputation?.score ?? 50)}`}>
                        {(agent.reputation?.score ?? 50).toFixed(0)}
                      </span>
                      <span className={`text-xs px-1.5 py-px rounded border leading-none uppercase font-medium ${modelBadge(agent.pricing.model)}`}>
                        {agent.pricing.model}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Zap size={9} className="text-purple-500" />
                        <span className="font-mono">${agent.pricing.price_per_call.toFixed(3)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <Star size={9} className="text-yellow-600" />
                        <span>{(agent.reputation?.avg_quality ?? 0).toFixed(1)}</span>
                        <span className="text-gray-700">·</span>
                        <span>{agent.reputation?.total_jobs ?? 0} jobs</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {agent.capabilities.slice(0, 3).map(cap => (
                        <span key={cap} className="text-xs bg-gray-800 text-gray-500 rounded-md px-1.5 py-0.5 leading-none">
                          {cap}
                        </span>
                      ))}
                      {agent.capabilities.length > 3 && (
                        <span className="text-xs text-gray-700">+{agent.capabilities.length - 3}</span>
                      )}
                    </div>
                  </div>

                  {!CORE_AGENTS.has(agent.agent_id) && (
                    <div className="shrink-0">
                      {confirmId === agent.agent_id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => removeAgent(agent.agent_id)}
                            disabled={deleting === agent.agent_id}
                            className="text-xs bg-red-950 text-red-400 border border-red-900 rounded-lg px-2 py-1 hover:bg-red-900 transition-colors"
                          >
                            {deleting === agent.agent_id ? '…' : 'Remove'}
                          </button>
                          <button onClick={() => setConfirmId(null)} className="text-gray-600 hover:text-gray-400 p-1">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(agent.agent_id)}
                          className="p-1.5 text-gray-700 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-all"
                          title="Remove agent"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
