import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Bot, Wallet, AlertTriangle, X } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { fetchVaultAccount } from '../lib/vault-client';

interface Props {
  onSubmit: (task: string, budget: number) => void;
  isRunning: boolean;
  orchestratorName: string;
  onFundVault?: () => void;
  onBotClick?: () => void;
}

const EXAMPLE_TASKS = [
  "What's the current XLM price and any recent Stellar news?",
  "Analyze Stellar DEX activity and write a market briefing",
  "Get blockchain news, live prices and compile a full report",
];

interface InsufficientModalProps {
  available: number;
  required: number;
  orchestratorName: string;
  onFund: () => void;
  onClose: () => void;
}

function InsufficientBalanceModal({ available, required, orchestratorName, onFund, onClose }: InsufficientModalProps) {
  const shortfall = Math.max(0, required - available);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-sm bg-gray-900 border border-amber-800/50 rounded-2xl shadow-2xl">
        <div className="px-5 pt-5 pb-4 border-b border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-950 border border-amber-800 flex items-center justify-center shrink-0">
              <AlertTriangle size={16} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-0.5">Insufficient vault balance</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {orchestratorName} needs <span className="text-white font-semibold">${required.toFixed(2)} USDC</span> to run this task.
              </p>
            </div>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-400 ml-auto shrink-0">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Your vault balance</span>
            <span className="text-white font-mono font-semibold">${available.toFixed(4)} USDC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Task budget</span>
            <span className="text-white font-mono font-semibold">${required.toFixed(4)} USDC</span>
          </div>
          <div className="flex justify-between text-xs border-t border-gray-800 pt-3">
            <span className="text-amber-400">Deposit needed</span>
            <span className="text-amber-400 font-mono font-semibold">${shortfall.toFixed(4)} USDC</span>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={onFund}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-purple-900/30"
          >
            <Wallet size={14} />
            Fund Vault
          </button>
        </div>
      </div>
    </div>
  );
}

export function TaskInput({ onSubmit, isRunning, orchestratorName, onFundVault, onBotClick }: Props) {
  const { publicKey } = useWallet();
  const [task, setTask] = useState('');
  const [budgetInput, setBudgetInput] = useState('');   // string — empty means "not set"
  const [vaultAvailable, setVaultAvailable] = useState<number | null>(null);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Poll vault balance
  useEffect(() => {
    if (!publicKey) return;
    const fetch = () =>
      fetchVaultAccount(publicKey)
        .then(a => setVaultAvailable(a?.available ?? 0))
        .catch(() => {});
    fetch();
    const t = setInterval(fetch, 10_000);
    return () => clearInterval(t);
  }, [publicKey]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [task]);

  const budget = parseFloat(budgetInput) || 0;
  const budgetValid = budget > 0;
  const balanceOk = !budgetValid || vaultAvailable === null || vaultAvailable >= budget;

  const handleSubmit = useCallback(() => {
    if (!task.trim() || isRunning || !budgetValid) return;
    if (vaultAvailable !== null && vaultAvailable < budget) {
      setShowInsufficientModal(true);
      return;
    }
    onSubmit(task.trim(), budget);
    setTask('');
  }, [task, isRunning, vaultAvailable, budget, budgetValid, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFundVault = () => {
    setShowInsufficientModal(false);
    onFundVault?.();
  };

  return (
    <>
      {showInsufficientModal && (
        <InsufficientBalanceModal
          available={vaultAvailable ?? 0}
          required={budget}
          orchestratorName={orchestratorName}
          onFund={handleFundVault}
          onClose={() => setShowInsufficientModal(false)}
        />
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Agent header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/80">
          <button
            onClick={onBotClick}
            className="relative shrink-0 group"
            title="View agent details"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl flex items-center justify-center shadow-lg shadow-purple-900/40 group-hover:from-purple-500 group-hover:to-purple-700 transition-all">
              <Bot size={14} className="text-white" />
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${
              isRunning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
            }`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white leading-none">{orchestratorName}</p>
            <p className="text-xs text-gray-500 leading-none mt-0.5">
              {isRunning ? 'Working on it…' : 'Ready for a task'}
            </p>
          </div>
          {vaultAvailable !== null && (
            <div className={`text-right shrink-0 ${balanceOk ? '' : 'text-amber-400'}`}>
              <p className="text-xs font-mono font-semibold text-gray-300">${vaultAvailable.toFixed(2)}</p>
              <p className="text-xs text-gray-600">vault</p>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="p-4">
          <p className="text-xs text-gray-500 mb-2.5">
            What do you want <span className="text-purple-400 font-medium">{orchestratorName}</span> to do?
          </p>

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={task}
              onChange={e => setTask(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder={`Ask ${orchestratorName} anything…`}
              rows={2}
              className="w-full bg-gray-800/80 border border-gray-700/80 rounded-xl px-3.5 py-3 pr-11 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-purple-500/70 focus:bg-gray-800 transition-all disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!task.trim() || isRunning || !budgetValid}
              title={!budgetValid ? 'Enter a budget first' : isRunning ? `${orchestratorName} is working on another task` : 'Send (⌘+Enter)'}
              className="absolute bottom-2.5 right-2.5 w-7 h-7 flex items-center justify-center bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-600 text-white rounded-lg transition-all shadow-sm"
            >
              <Send size={12} />
            </button>
          </div>

          {/* Example prompts */}
          {!task && !isRunning && (
            <div className="mt-2.5 space-y-1.5">
              {EXAMPLE_TASKS.map((t, i) => (
                <button
                  key={i}
                  onClick={() => setTask(t)}
                  className="w-full text-left text-xs text-gray-500 hover:text-gray-300 bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-2 transition-all leading-snug"
                >
                  <Sparkles size={9} className="inline mr-1.5 text-purple-500" />
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Running state */}
          {isRunning && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex gap-1">
                {[0, 150, 300].map(d => (
                  <span key={d} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
              <span className="text-xs text-gray-500">{orchestratorName} is working…</span>
            </div>
          )}
        </div>

        {/* Budget row */}
        <div className="px-4 py-3 border-t border-gray-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">Budget (USDC)</label>
            {vaultAvailable !== null && (
              <span className={`text-xs font-mono ${!balanceOk ? 'text-amber-400' : 'text-gray-600'}`}>
                vault: ${vaultAvailable.toFixed(2)}
              </span>
            )}
          </div>
          {/* Quick-fill chips */}
          <div className="grid grid-cols-4 gap-1.5">
            {[0.25, 0.50, 1.00, 2.00].map(q => (
              <button
                key={q}
                onClick={() => setBudgetInput(q.toFixed(2))}
                disabled={isRunning}
                className={`text-xs rounded-lg py-1.5 transition-all border font-mono disabled:opacity-40 ${
                  budgetInput === q.toFixed(2)
                    ? 'bg-purple-600/30 border-purple-600/60 text-purple-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                }`}
              >
                ${q.toFixed(2)}
              </button>
            ))}
          </div>
          {/* Input field — empty by default, like vault funding */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={budgetInput}
              onChange={e => setBudgetInput(e.target.value)}
              placeholder="0.00"
              disabled={isRunning}
              className={`w-full bg-gray-800/80 border rounded-xl pl-6 pr-14 py-2 text-sm font-mono font-semibold focus:outline-none transition-all disabled:opacity-50 ${
                !balanceOk && budgetValid
                  ? 'border-amber-700/60 text-amber-400 focus:border-amber-600'
                  : !budgetValid && budgetInput !== ''
                    ? 'border-red-800/60 text-red-400 focus:border-red-600'
                    : 'border-gray-700/80 text-purple-300 focus:border-purple-500/70'
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600">USDC</span>
          </div>
          {!balanceOk && budgetValid && vaultAvailable !== null && (
            <p className="text-xs text-amber-500/80">
              Exceeds vault balance — deposit ${(budget - vaultAvailable).toFixed(4)} more.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
