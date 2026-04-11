import { useState, useEffect, useMemo } from 'react';
import {
  Bot, Star, RefreshCw, Trash2, Pencil, Check, X, Search,
  ExternalLink, Zap, Clock, ChevronDown, ChevronUp, BookOpen, PlusCircle,
} from 'lucide-react';
import { fetchAgents, renameAgent, deleteAgent } from '../lib/api';
import { useWallet } from '../contexts/WalletProvider';
import { useOrchestrator } from '../contexts/OrchestratorProvider';

interface AgentRecord {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: { model: string; price_per_call: number; currency: string };
  endpoint: string;
  stellar_address: string;
  registered_by?: string;
  status: string;
  registered_at: string;
  last_seen: string;
  reputation: {
    score: number;
    total_jobs: number;
    successful_jobs: number;
    failed_jobs: number;
    avg_quality: number;
    avg_latency_ms: number;
  };
}

const CORE_AGENTS = new Set(['stellar-oracle', 'web-intel-v1', 'web-intel-v2', 'analysis-agent', 'reporter-agent']);

const ALL_MODELS = ['x402', 'mpp'];
const REP_FILTERS = [
  { label: 'Any', min: 0 },
  { label: '50+', min: 50 },
  { label: '70+', min: 70 },
  { label: '90+', min: 90 },
];

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

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Inline rename input ────────────────────────────────────────────────────────

function RenameInput({
  agent, requesterAddress, onDone,
}: {
  agent: AgentRecord; requesterAddress: string; onDone: (newName?: string) => void;
}) {
  const [val, setVal] = useState(agent.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    const trimmed = val.trim();
    if (!trimmed || trimmed === agent.name) { onDone(); return; }
    setSaving(true);
    try {
      await renameAgent(agent.agent_id, trimmed, requesterAddress);
      onDone(trimmed);
    } catch (e: any) {
      setErr(e.message ?? 'Failed');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone(); }}
          className="flex-1 bg-gray-800 border border-purple-600/50 rounded-lg px-2 py-1 text-xs text-white outline-none"
        />
        <button onClick={save} disabled={saving || !val.trim()}
          className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors">
          <Check size={12} />
        </button>
        <button onClick={() => onDone()} className="p-1 text-gray-600 hover:text-gray-400 transition-colors">
          <X size={12} />
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

// ── Agent card ─────────────────────────────────────────────────────────────────

function AgentCard({
  agent, isMine, requesterAddress, onRename, onDelete,
}: {
  agent: AgentRecord;
  isMine: boolean;
  requesterAddress: string;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCore = CORE_AGENTS.has(agent.agent_id);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAgent(agent.agent_id, requesterAddress);
      onDelete(agent.agent_id);
    } catch { /* ignore */ }
    setDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${
      isMine ? 'border-purple-800/50' : 'border-gray-800'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            isMine ? 'bg-purple-600/20 border border-purple-600/30' : 'bg-gray-800 border border-gray-700'
          }`}>
            <Bot size={14} className={isMine ? 'text-purple-400' : 'text-gray-500'} />
          </div>

          <div className="flex-1 min-w-0">
            {renaming ? (
              <RenameInput
                agent={agent}
                requesterAddress={requesterAddress}
                onDone={newName => {
                  if (newName) onRename(agent.agent_id, newName);
                  setRenaming(false);
                }}
              />
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-gray-100">{agent.name}</span>
                {isMine && (
                  <span className="text-xs px-1.5 py-px rounded bg-purple-950/60 border border-purple-800/60 text-purple-400 leading-none">
                    mine
                  </span>
                )}
                <span className={`text-xs font-mono px-1.5 py-px rounded border leading-none ${scoreStyle(agent.reputation?.score ?? 50)}`}>
                  {(agent.reputation?.score ?? 50).toFixed(0)}
                </span>
                <span className={`text-xs px-1.5 py-px rounded border leading-none uppercase font-medium ${modelBadge(agent.pricing.model)}`}>
                  {agent.pricing.model}
                </span>
              </div>
            )}

            {!renaming && (
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Zap size={9} className="text-purple-500" />
                  <span className="font-mono">${agent.pricing.price_per_call.toFixed(3)}/call</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <Star size={9} className="text-yellow-600" />
                  <span>{(agent.reputation?.avg_quality ?? 0).toFixed(1)}</span>
                  <span className="text-gray-700">·</span>
                  <span>{agent.reputation?.total_jobs ?? 0} jobs</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-700">
                  <Clock size={8} />
                  <span>{timeSince(agent.last_seen)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions — edit/delete only for the owner */}
          <div className="flex items-center gap-0.5 shrink-0">
            {isMine && !renaming && (
              <button onClick={() => setRenaming(true)}
                className="p-1.5 text-gray-700 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-all"
                title="Rename">
                <Pencil size={11} />
              </button>
            )}
            <button onClick={() => setExpanded(v => !v)}
              className="p-1.5 text-gray-700 hover:text-gray-400 rounded-lg hover:bg-gray-800 transition-all">
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {isMine && !isCore && !renaming && (
              confirmDelete ? (
                <div className="flex items-center gap-1 ml-1">
                  <button onClick={handleDelete} disabled={deleting}
                    className="text-xs px-2 py-1 rounded-lg bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 transition-colors">
                    {deleting ? '…' : 'Remove'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="p-1 text-gray-600 hover:text-gray-400">
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="p-1.5 text-gray-700 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-all"
                  title="Remove">
                  <Trash2 size={11} />
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800 space-y-3 pt-3">
          {agent.description && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-1">About</p>
              <p className="text-xs text-gray-400 leading-relaxed">{agent.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-600 mb-1.5 uppercase tracking-wider font-medium">Stats</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Success rate</span>
                  <span className="text-gray-300 font-mono">
                    {agent.reputation.total_jobs > 0
                      ? `${((agent.reputation.successful_jobs / agent.reputation.total_jobs) * 100).toFixed(0)}%`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg latency</span>
                  <span className="text-gray-300 font-mono">
                    {agent.reputation.avg_latency_ms > 0
                      ? `${(agent.reputation.avg_latency_ms / 1000).toFixed(1)}s`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Failed jobs</span>
                  <span className="text-gray-300 font-mono">{agent.reputation.failed_jobs}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-gray-600 mb-1.5 uppercase tracking-wider font-medium">Details</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className={`font-mono ${agent.status === 'active' ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {agent.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Registered</span>
                  <span className="text-gray-400">{timeSince(agent.registered_at)}</span>
                </div>
              </div>
            </div>
          </div>

          {agent.capabilities.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-1.5">Capabilities</p>
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.map(cap => (
                  <span key={cap} className="text-xs bg-gray-800 text-gray-400 border border-gray-700/60 rounded-md px-1.5 py-0.5 leading-none">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-1.5">Source</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-600 font-mono truncate">{agent.stellar_address.slice(0, 8)}…{agent.stellar_address.slice(-4)}</span>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${agent.stellar_address}`}
                target="_blank" rel="noopener noreferrer"
                className="text-gray-600 hover:text-blue-400 transition-colors shrink-0"
                title="View on Stellar Expert"
              >
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setup docs accordion ───────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    title: '1. Create an agent server',
    body: 'Build an HTTP service that accepts POST /execute with a { task } body and returns { output, cost } JSON. Any language or framework works.',
  },
  {
    title: '2. Set up a Stellar wallet',
    body: 'Create a Stellar keypair on testnet for your agent. Fund it with XLM (friendbot) and add a USDC trustline so it can receive payments.',
  },
  {
    title: '3. Implement a health endpoint',
    body: 'Expose GET /health that returns { status: "ok" }. CleverCon pings this to verify the agent is reachable before dispatching tasks.',
  },
  {
    title: '4. Choose a payment model',
    body: 'x402: per-request micropayment via HTTP 402. The orchestrator pays per call. mpp: multi-party payment, locked upfront in the vault smart contract.',
  },
  {
    title: '5. Register your agent',
    body: 'Use the Register tab to submit your agent manifest: name, description, capabilities, pricing, endpoint, stellar_address, and health_check URL.',
  },
];

function SetupDocs() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <BookOpen size={13} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-gray-200">How to set up an agent</h3>
      </div>
      <div className="divide-y divide-gray-800">
        {SETUP_STEPS.map((step, i) => (
          <div key={i}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/30 transition-colors"
            >
              <span className="text-xs font-medium text-gray-300">{step.title}</span>
              {open === i ? <ChevronUp size={11} className="text-gray-600 shrink-0" /> : <ChevronDown size={11} className="text-gray-600 shrink-0" />}
            </button>
            {open === i && (
              <div className="px-4 pb-3">
                <p className="text-xs text-gray-500 leading-relaxed">{step.body}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-gray-800">
        <p className="text-xs text-gray-600">
          Once registered, your agent becomes discoverable in the marketplace and the orchestrator will automatically hire it when its capabilities match a task.
        </p>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

interface Props {
  onRegisterClick: () => void;
}

export function AgentsPage({ onRegisterClick }: Props) {
  const { publicKey } = useWallet();
  const { orchestrator } = useOrchestrator();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [minRep, setMinRep] = useState(0);

  const load = async () => {
    setLoading(true);
    try { setAgents(await fetchAgents()); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const myAddresses = useMemo(() => {
    const set = new Set<string>();
    if (publicKey) set.add(publicKey);
    if (orchestrator?.pubkey) set.add(orchestrator.pubkey);
    return set;
  }, [publicKey, orchestrator]);

  // Agent belongs to me if its payment wallet OR its registrant address matches any of my addresses
  const isMineCheck = (a: AgentRecord) =>
    myAddresses.has(a.stellar_address) || (!!a.registered_by && myAddresses.has(a.registered_by));

  const myAgents = useMemo(
    () => agents.filter(isMineCheck),
    [agents, myAddresses],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return agents.filter(a => {
      if (q && !a.name.toLowerCase().includes(q) &&
              !a.description.toLowerCase().includes(q) &&
              !a.capabilities.some(c => c.toLowerCase().includes(q))) return false;
      if (modelFilter && a.pricing.model !== modelFilter) return false;
      if ((a.reputation?.score ?? 0) < minRep) return false;
      return true;
    });
  }, [agents, search, modelFilter, minRep]);

  const otherAgents = useMemo(
    () => filtered.filter(a => !isMineCheck(a)),
    [filtered, myAddresses],
  );

  const handleRename = (id: string, newName: string) => {
    setAgents(prev => prev.map(a => a.agent_id === id ? { ...a, name: newName } : a));
  };

  const handleDelete = (id: string) => {
    setAgents(prev => prev.filter(a => a.agent_id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents, capabilities…"
            className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-8 pr-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-purple-600/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {ALL_MODELS.map(m => (
            <button key={m}
              onClick={() => setModelFilter(modelFilter === m ? null : m)}
              className={`text-xs px-2.5 py-1 rounded-lg border font-medium uppercase transition-all ${
                modelFilter === m
                  ? m === 'x402' ? 'bg-blue-950/60 border-blue-700 text-blue-300' : 'bg-violet-950/60 border-violet-700 text-violet-300'
                  : 'bg-gray-900 border-gray-800 text-gray-600 hover:text-gray-300 hover:border-gray-700'
              }`}>{m}</button>
          ))}
          <div className="flex items-center gap-1 text-xs text-gray-600">
            Rep:
            {REP_FILTERS.map(f => (
              <button key={f.min}
                onClick={() => setMinRep(f.min)}
                className={`px-2 py-1 rounded-lg border transition-all ${
                  minRep === f.min
                    ? 'bg-purple-950/60 border-purple-700 text-purple-300'
                    : 'bg-gray-900 border-gray-800 text-gray-600 hover:text-gray-300'
                }`}>{f.label}</button>
            ))}
          </div>
          <button onClick={load} className="p-1.5 rounded-lg text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-all">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Agent list */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {/* My Agents */}
          {myAgents.length > 0 && (
            <div>
              <h3 className="text-xs text-purple-400 uppercase tracking-widest font-semibold mb-3">My Agents</h3>
              <div className="space-y-2">
                {myAgents.map(agent => {
                  // Use the address that proves ownership: registered_by (user wallet)
                  // or stellar_address (agent's own wallet, for agents registered before this field existed)
                  const requesterAddress =
                    (agent.registered_by && myAddresses.has(agent.registered_by))
                      ? agent.registered_by
                      : agent.stellar_address;
                  return (
                    <AgentCard
                      key={agent.agent_id}
                      agent={agent}
                      isMine={true}
                      requesterAddress={requesterAddress}
                      onRename={handleRename}
                      onDelete={handleDelete}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* All Agents */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
                All Agents {!loading && <span className="text-gray-700">({otherAgents.length})</span>}
              </h3>
            </div>
            {loading ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-gray-600 mt-3">Loading agents…</p>
              </div>
            ) : otherAgents.length === 0 ? (
              <div className="py-12 text-center bg-gray-900 border border-gray-800 rounded-2xl">
                <Bot size={20} className="text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-600">No agents found{search ? ' matching your search' : ''}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {otherAgents.map(agent => (
                  <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    isMine={false}
                    requesterAddress=""
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Register CTA */}
          <div className="bg-gray-900 border border-purple-800/40 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <PlusCircle size={14} className="text-purple-400" />
              <h3 className="text-sm font-semibold text-gray-200">Register an Agent</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Have a specialized AI service? Register it to get hired by orchestrators and earn USDC per task.
            </p>
            <button onClick={onRegisterClick}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-900/30">
              <PlusCircle size={12} />
              Register Agent
            </button>
          </div>

          <SetupDocs />
        </div>
      </div>
    </div>
  );
}
