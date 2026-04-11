import { useState, useEffect } from 'react';
import {
  History, CheckCircle, XCircle, ChevronDown, ChevronUp,
  ArrowUpRight, RefreshCw, ExternalLink, Clock, Trash2,
  FileText, Receipt,
} from 'lucide-react';
import { fetchTaskHistory, deleteTaskHistory } from '../lib/api';
import { useWallet } from '../contexts/WalletProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StepResult {
  step_id: number;
  agent_id: string;
  agent_name: string;
  success: boolean;
  output: string | null;
  error: string | null;
  payment: { amount: number; tx_hash: string | null; explorer_url: string | null; method: string };
  quality_rating: number | null;
  latency_ms: number;
  timestamp: string;
}

interface TaskResultEntry {
  task_id: string;
  prompt: string;
  status: 'complete' | 'partial' | 'failed';
  total_cost: number;
  total_time_ms: number;
  final_output: string | null;
  steps: StepResult[];
  timestamp: string;
}

const EXPLORER_TX = 'https://stellar.expert/explorer/testnet/tx';
const MAX_PROMPT_LEN = 80;

// ── Markdown renderer (minimal) ───────────────────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-xs font-semibold text-gray-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="text-sm font-bold text-white mt-4 mb-1.5">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="text-base font-bold text-white mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-200 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g,    '<em class="text-gray-300">$1</em>')
    .replace(/`([^`]+)`/g,    '<code class="font-mono text-xs bg-gray-800 text-purple-300 px-1 rounded">$1</code>')
    .replace(/^- (.+)$/gm,    '<li class="text-xs text-gray-400 ml-4 list-disc leading-relaxed">$1</li>')
    .replace(/^\d+\. (.+)$/gm,'<li class="text-xs text-gray-400 ml-4 list-decimal leading-relaxed">$1</li>')
    .split('\n')
    .map(line => {
      if (!line.trim()) return '';
      if (line.startsWith('<')) return line;
      return `<p class="text-xs text-gray-400 leading-relaxed mb-1">${line}</p>`;
    })
    .join('\n');
}

// ── Result display ─────────────────────────────────────────────────────────────

function ResultDisplay({ entry }: { entry: TaskResultEntry }) {
  const statusColor =
    entry.status === 'complete' ? 'text-emerald-400' :
    entry.status === 'partial'  ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-3">
      {/* Output */}
      {entry.final_output && (
        <div className="bg-gray-800/50 border border-gray-700/60 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/60">
            <FileText size={11} className="text-purple-400" />
            <span className="text-xs font-medium text-gray-300">Result</span>
            <span className={`text-xs ml-auto capitalize font-medium ${statusColor}`}>{entry.status}</span>
          </div>
          <div
            className="px-3 py-2.5 prose-sm max-h-64 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.final_output) }}
          />
        </div>
      )}

      {/* Receipt */}
      <div className="bg-gray-800/50 border border-gray-700/60 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/60">
          <Receipt size={11} className="text-purple-400" />
          <span className="text-xs font-medium text-gray-300">Receipt</span>
          <span className="text-xs font-mono text-red-400 ml-auto">-${entry.total_cost.toFixed(4)}</span>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
            <div>
              <p className="text-gray-600">Task ID</p>
              <p className="text-gray-500 font-mono">{entry.task_id.slice(0, 12)}…</p>
            </div>
            <div>
              <p className="text-gray-600">Duration</p>
              <p className="text-gray-400 font-mono">{(entry.total_time_ms / 1000).toFixed(1)}s</p>
            </div>
          </div>
          {entry.steps.length > 0 && (
            <div className="space-y-1">
              {entry.steps.map(step => (
                <div key={step.step_id} className="flex items-center gap-2 text-xs bg-gray-800 rounded-lg px-2.5 py-1.5">
                  {step.success
                    ? <CheckCircle size={10} className="text-emerald-400 shrink-0" />
                    : <XCircle   size={10} className="text-red-400 shrink-0" />}
                  <span className="text-gray-400 truncate flex-1">{step.agent_name}</span>
                  {step.payment.amount > 0 && (
                    <span className="text-purple-400 font-mono shrink-0">
                      <ArrowUpRight size={9} className="inline" />${step.payment.amount.toFixed(4)}
                    </span>
                  )}
                  {step.payment.tx_hash && (
                    <a href={`${EXPLORER_TX}/${step.payment.tx_hash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-gray-700 hover:text-blue-400 transition-colors shrink-0"
                      title="View on Stellar Expert">
                      <ExternalLink size={9} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Task row ───────────────────────────────────────────────────────────────────

function TaskRow({
  entry, userAddress, onDelete,
}: {
  entry: TaskResultEntry; userAddress: string; onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const truncated = entry.prompt.length > MAX_PROMPT_LEN
    ? entry.prompt.slice(0, MAX_PROMPT_LEN) + '…'
    : entry.prompt;

  const statusColor =
    entry.status === 'complete' ? 'text-emerald-400' :
    entry.status === 'partial'  ? 'text-amber-400' : 'text-red-400';

  const handleDelete = async () => {
    setDeleting(true);
    await deleteTaskHistory(entry.task_id, userAddress);
    onDelete(entry.task_id);
  };

  return (
    <div className="border-b border-gray-800/60 last:border-0">
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Expand button */}
        <button onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
          <div className="shrink-0">
            {entry.status === 'complete' && <CheckCircle size={13} className="text-emerald-400" />}
            {entry.status === 'partial'  && <CheckCircle size={13} className="text-amber-400" />}
            {entry.status === 'failed'   && <XCircle size={13} className="text-red-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-200 leading-relaxed" title={entry.prompt}>{truncated}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <Clock size={8} />
                <span>{new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {entry.steps.length > 0 && (
                <span className="text-xs text-gray-700">{entry.steps.length} step{entry.steps.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right mr-1">
            {entry.total_cost > 0 && (
              <p className="text-xs font-mono font-semibold text-red-400">-${entry.total_cost.toFixed(4)}</p>
            )}
            <p className={`text-xs capitalize ${statusColor}`}>{entry.status}</p>
          </div>
          <div className="text-gray-700 shrink-0">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </div>
        </button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs px-2 py-1 rounded-lg bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 transition-colors">
              {deleting ? '…' : 'Delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="p-1 text-gray-600 hover:text-gray-400">
              <XCircle size={11} />
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="p-1 shrink-0 text-gray-700 hover:text-red-400 transition-colors" title="Delete">
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <ResultDisplay entry={entry} />
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function TaskHistory() {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<TaskResultEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!publicKey) return;
    setLoading(true);
    try { setEntries(await fetchTaskHistory(publicKey)); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [publicKey]);

  const handleDelete = (id: string) => {
    setEntries(prev => prev.filter(e => e.task_id !== id));
  };

  const completed = entries.filter(e => e.status === 'complete').length;
  const totalSpent = entries.reduce((s, e) => s + e.total_cost, 0);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Summary */}
      {entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Tasks', value: entries.length, color: 'text-gray-200' },
            { label: 'Completed', value: completed, color: 'text-emerald-400' },
            { label: 'Total spent', value: `$${totalSpent.toFixed(4)}`, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-center">
              <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-600 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <History size={13} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-200">Task History</h2>
            {entries.length > 0 && (
              <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-md">{entries.length}</span>
            )}
          </div>
          <button onClick={load} className="p-1 text-gray-600 hover:text-gray-400 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && entries.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-gray-600 mt-2">Loading…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <History size={20} className="text-gray-700 mx-auto mb-2" />
            <p className="text-xs text-gray-600">No completed tasks yet</p>
            <p className="text-xs text-gray-700 mt-1">Task results will appear here after completion</p>
          </div>
        ) : (
          <div>
            {entries.map(e => (
              <TaskRow key={e.task_id} entry={e} userAddress={publicKey!} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
