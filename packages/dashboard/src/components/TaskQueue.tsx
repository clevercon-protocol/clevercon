import { useState, useEffect } from 'react';
import {
  Plus, X, Clock, CheckCircle, XCircle, Zap,
  ChevronDown, ChevronUp, AlertTriangle, Play, Pencil, RotateCcw,
} from 'lucide-react';

export interface QueueItem {
  id: string;
  task: string;
  budget: number;
  delay_ms: number;         // wait after *previous* task completes (irrelevant for first)
  status: 'queued' | 'countdown' | 'running' | 'done' | 'failed';
  scheduled_run_at?: number;
  failReason?: string;
}

interface Props {
  items: QueueItem[];
  vaultAvailable: number | null;
  onAdd: (task: string, budget: number, delay_ms: number) => void;
  onUpdate: (id: string, task: string, budget: number, delay_ms: number) => void;
  onRemove: (id: string) => void;
  onClearDone: () => void;
  onRunQueue: () => void;
}

const DELAY_CHIPS = [
  { label: '30s',    ms: 30_000 },
  { label: '5 min',  ms: 300_000 },
  { label: '15 min', ms: 900_000 },
  { label: '30 min', ms: 1_800_000 },
];

const BUDGET_CHIPS = [0.25, 0.50, 1.00, 2.00];

function fmtCountdown(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDelay(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)} min`;
}

// ── Inline edit form ──────────────────────────────────────────────────────────

function ItemEditForm({
  initial,
  isFirst,
  onSave,
  onCancel,
}: {
  initial: QueueItem;
  isFirst: boolean;
  onSave: (task: string, budget: number, delay_ms: number) => void;
  onCancel: () => void;
}) {
  const [task, setTask] = useState(initial.task);
  const [budgetInput, setBudgetInput] = useState(initial.budget.toFixed(2));
  const [delayMs, setDelayMs] = useState(initial.delay_ms);
  const [customSec, setCustomSec] = useState('');
  const [customMin, setCustomMin] = useState('');

  const budget = parseFloat(budgetInput) || 0;

  return (
    <div className="px-3 py-2.5 space-y-2.5 bg-gray-800/60 border border-purple-800/40 rounded-xl">
      <textarea
        rows={2}
        value={task}
        onChange={e => setTask(e.target.value)}
        autoFocus
        className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/70 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 resize-none outline-none transition-colors"
      />

      {/* Budget */}
      <div>
        <p className="text-xs text-gray-600 mb-1">Budget</p>
        <div className="grid grid-cols-4 gap-1 mb-1">
          {BUDGET_CHIPS.map(q => (
            <button
              key={q}
              onClick={() => setBudgetInput(q.toFixed(2))}
              className={`text-xs py-1 rounded-lg border transition-all font-mono ${
                budgetInput === q.toFixed(2)
                  ? 'bg-purple-600/30 border-purple-600/60 text-purple-300'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
              }`}
            >
              ${q.toFixed(2)}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
          <input
            type="number" min={0.01} step={0.01}
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg pl-5 pr-3 py-1 text-xs font-mono font-semibold text-purple-300 outline-none transition-all"
          />
        </div>
      </div>

      {/* Delay — only for non-first items */}
      {!isFirst && (
        <div>
          <p className="text-xs text-gray-600 mb-1">Wait after previous task</p>
          <div className="grid grid-cols-4 gap-1">
            {DELAY_CHIPS.map(c => (
              <button
                key={c.ms}
                onClick={() => { setDelayMs(c.ms); setCustomSec(''); setCustomMin(''); }}
                className={`text-xs py-1 rounded-lg border transition-all font-mono ${
                  delayMs === c.ms && !customSec && !customMin
                    ? 'bg-purple-600/30 border-purple-600/60 text-purple-300'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            <div className="relative">
              <input type="number" min="1" placeholder="Seconds" value={customSec}
                onChange={e => { setCustomSec(e.target.value); setCustomMin(''); const s = parseFloat(e.target.value); if (!isNaN(s) && s > 0) setDelayMs(Math.round(s * 1000)); }}
                className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg px-2.5 pr-6 py-1 text-xs text-gray-300 placeholder-gray-600 outline-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 pointer-events-none">s</span>
            </div>
            <div className="relative">
              <input type="number" min="1" placeholder="Minutes" value={customMin}
                onChange={e => { setCustomMin(e.target.value); setCustomSec(''); const m = parseFloat(e.target.value); if (!isNaN(m) && m > 0) setDelayMs(Math.round(m * 60_000)); }}
                className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg px-2.5 pr-6 py-1 text-xs text-gray-300 placeholder-gray-600 outline-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 pointer-events-none">m</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        <button onClick={onCancel}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
          <RotateCcw size={9} /> Cancel
        </button>
        <button
          onClick={() => { if (task.trim() && budget > 0) onSave(task.trim(), budget, delayMs); }}
          disabled={!task.trim() || budget <= 0}
          className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-medium transition-colors">
          <CheckCircle size={9} /> Save
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaskQueue({ items, vaultAvailable, onAdd, onUpdate, onRemove, onClearDone, onRunQueue }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add-form state
  const [taskText, setTaskText] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [delayMs, setDelayMs] = useState(300_000);
  const [customSec, setCustomSec] = useState('');
  const [customMin, setCustomMin] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const handleAdd = () => {
    const budget = parseFloat(budgetInput) || 0;
    if (!taskText.trim() || budget <= 0) return;
    onAdd(taskText.trim(), budget, delayMs);
    setTaskText(''); setBudgetInput(''); setDelayMs(300_000); setCustomSec(''); setCustomMin('');
    setShowForm(false);
  };

  const hasDone = items.some(i => i.status === 'done' || i.status === 'failed');
  const activeItems = items.filter(i => i.status !== 'done' && i.status !== 'failed');
  const queuedItems = items.filter(i => i.status === 'queued');

  const committedBudget = activeItems.reduce((sum, i) => sum + i.budget, 0);
  const totalOver = vaultAvailable !== null && committedBudget > vaultAvailable;

  const cumulativeAt: number[] = [];
  let runningSum = 0;
  for (const item of items) {
    if (item.status === 'queued' || item.status === 'countdown' || item.status === 'running') {
      runningSum += item.budget;
    }
    cumulativeAt.push(runningSum);
  }

  const addBudget = parseFloat(budgetInput) || 0;
  const remaining = vaultAvailable !== null ? Math.max(0, vaultAvailable - committedBudget) : null;
  const newItemAffordable = remaining === null || addBudget <= 0 || addBudget <= remaining;

  const canRunQueue = queuedItems.length > 0 && !items.some(i => i.status === 'running' || i.status === 'countdown');

  if (items.length === 0 && !showForm) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock size={12} />
          <span>No tasks queued</span>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-950/40 hover:bg-purple-950/60 border border-purple-900/60 rounded-lg px-2.5 py-1 transition-all">
          <Plus size={11} /> Schedule
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Clock size={13} className="text-purple-400" />
        <span className="text-sm font-semibold text-gray-200 flex-1">Queue</span>
        {activeItems.length > 0 && (
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${totalOver ? 'text-amber-400 bg-amber-950/40' : 'text-gray-500 bg-gray-800'}`}>
            ${committedBudget.toFixed(2)}
          </span>
        )}
        {activeItems.length > 0 && (
          <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{activeItems.length}</span>
        )}
        {hasDone && (
          <button onClick={onClearDone} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Clear done</button>
        )}
        <button onClick={() => setShowForm(v => !v)} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
          <Plus size={11} />
        </button>
        <button onClick={() => setCollapsed(v => !v)} className="text-gray-600 hover:text-gray-400 transition-colors">
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>

      {totalOver && !collapsed && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-b border-amber-900/30">
          <AlertTriangle size={10} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400">
            Pipeline needs <span className="font-mono font-semibold">${committedBudget.toFixed(2)}</span> but vault has{' '}
            <span className="font-mono font-semibold">${vaultAvailable!.toFixed(2)}</span>.
          </p>
        </div>
      )}

      {!collapsed && (
        <>
          {items.length > 0 && (
            <div className="px-3 py-3 space-y-0">
              {items.map((item, idx) => {
                const isFirst = idx === 0 || items.slice(0, idx).every(i => i.status === 'done' || i.status === 'failed');
                const isCountdown = item.status === 'countdown' && item.scheduled_run_at;
                const remaining = isCountdown ? item.scheduled_run_at! - Date.now() : 0;
                const progress = isCountdown
                  ? Math.max(0, Math.min(100, (1 - remaining / item.delay_ms) * 100))
                  : 0;
                const cumulative = cumulativeAt[idx];
                const affordWarning = vaultAvailable !== null &&
                  (item.status === 'queued' || item.status === 'countdown') &&
                  cumulative > vaultAvailable;
                const isEditing = editingId === item.id;

                return (
                  <div key={item.id}>
                    {idx > 0 && !isFirst && (
                      <div className="flex items-center gap-2 py-1 pl-3">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="w-px h-3 bg-gray-700" />
                          <div className="w-px h-3 bg-gray-700" />
                        </div>
                        <span className="text-xs text-gray-700 font-mono">+{fmtDelay(item.delay_ms)}</span>
                      </div>
                    )}

                    {isEditing ? (
                      <ItemEditForm
                        initial={item}
                        isFirst={isFirst}
                        onSave={(t, b, d) => { onUpdate(item.id, t, b, d); setEditingId(null); }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className={`flex items-start gap-2 rounded-xl p-2.5 transition-colors ${
                        item.status === 'running'   ? 'bg-amber-950/30 border border-amber-900/40' :
                        item.status === 'countdown' ? 'bg-purple-950/30 border border-purple-900/40' :
                        item.status === 'done'      ? 'bg-gray-800/30 border border-gray-800/60' :
                        item.status === 'failed'    ? 'bg-red-950/20 border border-red-900/30' :
                        affordWarning               ? 'bg-amber-950/15 border border-amber-900/30' :
                        'bg-gray-800/40 border border-gray-800/60'
                      }`}>
                        <div className="mt-0.5 shrink-0">
                          {item.status === 'running'   && <Zap size={12} className="text-amber-400 animate-pulse" />}
                          {item.status === 'countdown' && <Clock size={12} className="text-purple-400" />}
                          {item.status === 'queued'    && (affordWarning ? <AlertTriangle size={12} className="text-amber-500" /> : <div className="w-3 h-3 rounded-full border-2 border-gray-600" />)}
                          {item.status === 'done'      && <CheckCircle size={12} className="text-emerald-500" />}
                          {item.status === 'failed'    && <XCircle size={12} className="text-red-500" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate leading-relaxed ${item.status === 'done' || item.status === 'failed' ? 'text-gray-600' : 'text-gray-300'}`}>
                            {item.task}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs font-mono ${affordWarning ? 'text-amber-600' : 'text-gray-600'}`}>
                              ${item.budget.toFixed(2)}
                            </span>
                            {isFirst && item.status === 'queued' && (
                              <span className="text-xs text-purple-500 italic">starts first</span>
                            )}
                            {affordWarning && <span className="text-xs text-amber-600 italic">may be short</span>}
                            {isCountdown && remaining > 0 && (
                              <div className="flex items-center gap-1.5 flex-1">
                                <div className="flex-1 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div className="h-full bg-purple-500 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
                                </div>
                                <span className="text-xs font-mono text-purple-400 tabular-nums shrink-0">{fmtCountdown(remaining)}</span>
                              </div>
                            )}
                            {isCountdown && remaining <= 0 && (
                              <span className="text-xs text-purple-400 italic">starting…</span>
                            )}
                            {item.status === 'running' && <span className="text-xs text-amber-400">running now</span>}
                          </div>
                          {item.status === 'failed' && item.failReason && (
                            <p className="text-xs text-red-500 mt-1 leading-snug">{item.failReason}</p>
                          )}
                        </div>

                        {(item.status === 'queued') && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => setEditingId(item.id)} className="p-1 text-gray-700 hover:text-gray-300 transition-colors" title="Edit">
                              <Pencil size={10} />
                            </button>
                            <button onClick={() => onRemove(item.id)} className="p-1 text-gray-700 hover:text-red-400 transition-colors">
                              <X size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Run Queue button */}
          {canRunQueue && (
            <div className="px-3 pb-3">
              <button onClick={onRunQueue}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-900/30">
                <Play size={11} />
                Review & Run Queue ({queuedItems.length} task{queuedItems.length !== 1 ? 's' : ''})
              </button>
            </div>
          )}

          {/* Add task form */}
          {showForm && (
            <div className="px-4 pb-4 pt-1 border-t border-gray-800 space-y-3">
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-gray-500">Add to queue</p>
                {vaultAvailable !== null && (
                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    <span className="text-gray-600">vault ${vaultAvailable.toFixed(2)}</span>
                    {committedBudget > 0 && (
                      <span className={remaining !== null && addBudget > 0 && addBudget > remaining ? 'text-amber-400' : 'text-gray-500'}>
                        · rem ${(remaining ?? 0).toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <textarea rows={2} value={taskText} onChange={e => setTaskText(e.target.value)}
                placeholder="What should the agent do next?"
                className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/70 rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 resize-none outline-none transition-colors"
              />

              {/* Delay — only shown when there are already other items (this won't be the first) */}
              {activeItems.length > 0 && <div>
                <p className="text-xs text-gray-600 mb-1.5">Wait after previous task</p>
                <div className="grid grid-cols-4 gap-1">
                  {DELAY_CHIPS.map(c => (
                    <button key={c.ms}
                      onClick={() => { setDelayMs(c.ms); setCustomSec(''); setCustomMin(''); }}
                      className={`text-xs py-1.5 rounded-lg border transition-all font-mono ${delayMs === c.ms && !customSec && !customMin ? 'bg-purple-600/30 border-purple-600/60 text-purple-300' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  <div className="relative">
                    <input type="number" min="1" placeholder="Seconds" value={customSec}
                      onChange={e => { setCustomSec(e.target.value); setCustomMin(''); const s = parseFloat(e.target.value); if (!isNaN(s) && s > 0) setDelayMs(Math.round(s * 1000)); }}
                      className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg px-2.5 pr-6 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-600 pointer-events-none">s</span>
                  </div>
                  <div className="relative">
                    <input type="number" min="1" placeholder="Minutes" value={customMin}
                      onChange={e => { setCustomMin(e.target.value); setCustomSec(''); const m = parseFloat(e.target.value); if (!isNaN(m) && m > 0) setDelayMs(Math.round(m * 60_000)); }}
                      className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/50 rounded-lg px-2.5 pr-6 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-600 pointer-events-none">m</span>
                  </div>
                </div>
              </div>}

              {/* Budget */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-gray-600">Budget</p>
                  {!newItemAffordable && vaultAvailable !== null && (
                    <span className="text-xs text-amber-500 flex items-center gap-1"><AlertTriangle size={9} />exceeds remaining ${(remaining ?? 0).toFixed(2)}</span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {BUDGET_CHIPS.map(q => {
                    const affordable = remaining === null || q <= remaining;
                    return (
                      <button key={q} onClick={() => setBudgetInput(q.toFixed(2))}
                        className={`text-xs py-1.5 rounded-lg border transition-all font-mono ${
                          budgetInput === q.toFixed(2)
                            ? affordable ? 'bg-purple-600/30 border-purple-600/60 text-purple-300' : 'bg-amber-900/30 border-amber-700/60 text-amber-300'
                            : affordable ? 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300' : 'bg-gray-800 border-amber-900/40 text-amber-700 hover:text-amber-500'
                        }`}>
                        ${q.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
                <div className="relative mt-1.5">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                  <input type="number" min={0.01} step={0.01}
                    value={budgetInput}
                    onChange={e => setBudgetInput(e.target.value)}
                    placeholder="0.00"
                    className={`w-full bg-gray-800 border rounded-lg pl-5 pr-3 py-1.5 text-xs font-mono font-semibold focus:outline-none transition-all ${
                      !newItemAffordable && addBudget > 0
                        ? 'border-amber-700/60 text-amber-400 focus:border-amber-600'
                        : 'border-gray-700 text-purple-300 focus:border-purple-500/50'
                    }`}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 text-xs py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">Cancel</button>
                <button onClick={handleAdd}
                  disabled={!taskText.trim() || addBudget <= 0}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-medium transition-colors">
                  <Plus size={11} />
                  {!newItemAffordable && addBudget > 0 ? 'Add Anyway' : 'Add to Queue'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
