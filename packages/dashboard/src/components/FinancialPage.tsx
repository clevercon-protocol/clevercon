import { useState, useEffect } from 'react';
import { ExternalLink, RefreshCw, TrendingUp, Shield, ArrowDownLeft, ArrowUpRight, Banknote } from 'lucide-react';
import { fetchVaultLedger } from '../lib/api';
import { fetchAgents } from '../lib/api';
import { useWallet } from '../contexts/WalletProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

interface VaultLedgerEntry {
  id: string;
  type: 'deposit' | 'withdrawal' | 'payment' | 'budget_lock';
  amount_usdc: number;
  tx_hash?: string;
  task_id?: string;
  agent_name?: string;
  timestamp: string;
}

interface AgentRecord {
  agent_id: string;
  name: string;
  pricing: { price_per_call: number; model: string };
  reputation: { total_jobs: number; successful_jobs: number; avg_quality: number; score: number };
}

const EXPLORER_TX = 'https://stellar.expert/explorer/testnet/tx';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Vault Transaction Table ────────────────────────────────────────────────────

function typeLabel(type: VaultLedgerEntry['type']): string {
  if (type === 'deposit') return 'Deposit';
  if (type === 'withdrawal') return 'Withdrawal';
  if (type === 'payment') return 'Agent payment';
  if (type === 'budget_lock') return 'Budget locked';
  return type;
}

function typeIcon(type: VaultLedgerEntry['type']) {
  if (type === 'deposit')    return <ArrowDownLeft size={12} className="text-emerald-400" />;
  if (type === 'withdrawal') return <ArrowUpRight  size={12} className="text-red-400" />;
  if (type === 'payment')    return <ArrowUpRight  size={12} className="text-purple-400" />;
  return <Shield size={12} className="text-amber-400" />;
}

function isCredit(type: VaultLedgerEntry['type']): boolean {
  return type === 'deposit';
}

function VaultLedgerTable({ entries, loading, onRefresh }: {
  entries: VaultLedgerEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const totalIn  = entries.filter(e => isCredit(e.type)).reduce((s, e) => s + e.amount_usdc, 0);
  const totalOut = entries.filter(e => !isCredit(e.type) && e.type !== 'budget_lock').reduce((s, e) => s + e.amount_usdc, 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-gray-200">Vault Transactions</h2>
        </div>
        <div className="flex items-center gap-3">
          {entries.length > 0 && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-emerald-400">+${totalIn.toFixed(4)}</span>
              <span className="text-red-400">-${totalOut.toFixed(4)}</span>
            </div>
          )}
          <button onClick={onRefresh} className="p-1 text-gray-600 hover:text-gray-400 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="py-12 text-center">
          <Banknote size={20} className="text-gray-700 mx-auto mb-2" />
          <p className="text-xs text-gray-600">No transactions yet</p>
          <p className="text-xs text-gray-700 mt-1">Deposits, withdrawals and agent payments will appear here</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider text-left">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Task / Agent</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Date</th>
                <th className="px-4 py-2 font-medium text-center">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {typeIcon(entry.type)}
                      <span className={`font-medium ${
                        isCredit(entry.type) ? 'text-emerald-300' :
                        entry.type === 'payment' ? 'text-purple-300' :
                        entry.type === 'withdrawal' ? 'text-red-300' :
                        'text-amber-300'
                      }`}>{typeLabel(entry.type)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold">
                    <span className={isCredit(entry.type) ? 'text-emerald-400' : 'text-red-400'}>
                      {isCredit(entry.type) ? '+' : '-'}${entry.amount_usdc.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell text-gray-500 max-w-[200px]">
                    {entry.agent_name && <span className="truncate block">{entry.agent_name}</span>}
                    {entry.task_id && !entry.agent_name && (
                      <span className="font-mono text-gray-700 truncate block" title={entry.task_id}>
                        {entry.task_id.slice(0, 12)}…
                      </span>
                    )}
                    {!entry.agent_name && !entry.task_id && <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-gray-600 whitespace-nowrap">
                    {fmtDate(entry.timestamp)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {entry.tx_hash ? (
                      <a
                        href={`${EXPLORER_TX}/${entry.tx_hash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex text-gray-600 hover:text-blue-400 transition-colors"
                        title="View on Stellar Expert"
                      >
                        <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="text-gray-800">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Earnings View (inline) ─────────────────────────────────────────────────────

function EarningsSection() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  useEffect(() => {
    const load = async () => {
      try { setAgents(await fetchAgents()); } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 15_000);
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
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <TrendingUp size={13} className="text-emerald-400" />
          <h2 className="text-sm font-semibold text-gray-200">Agent Earnings</h2>
        </div>
        <span className="text-sm font-mono font-bold text-emerald-400">${totalEarned.toFixed(4)}</span>
      </div>
      <div className="p-4 space-y-2.5">
        {sorted.map(agent => {
          const earned = agent.reputation.successful_jobs * agent.pricing.price_per_call;
          const maxEarned = sorted[0]
            ? sorted[0].reputation.successful_jobs * sorted[0].pricing.price_per_call
            : 1;
          const pct = maxEarned > 0 ? (earned / maxEarned) * 100 : 0;
          return (
            <div key={agent.agent_id}>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="text-xs font-medium text-gray-200">{agent.name}</span>
                  <span className="text-xs text-gray-600 ml-2">
                    {agent.reputation.successful_jobs}/{agent.reputation.total_jobs} jobs
                  </span>
                </div>
                <span className="text-xs font-mono text-emerald-400">${earned.toFixed(4)}</span>
              </div>
              <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {agents.length === 0 && (
          <p className="text-xs text-gray-600 py-4 text-center">Loading agent data…</p>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function FinancialPage() {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<VaultLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!publicKey) return;
    setLoading(true);
    try { setEntries(await fetchVaultLedger(publicKey)); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [publicKey]);

  return (
    <div className="grid grid-cols-12 gap-6 items-start">
      <div className="col-span-12 lg:col-span-8">
        <VaultLedgerTable entries={entries} loading={loading} onRefresh={load} />
      </div>
      <div className="col-span-12 lg:col-span-4">
        <EarningsSection />
      </div>
    </div>
  );
}
