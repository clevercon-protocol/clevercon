import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layers, PlusCircle, LogOut, Shield,
  Zap, AlertTriangle, X, History, Bot,
} from 'lucide-react';
const makeId = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
import { TaskInput } from './components/TaskInput';
import { TaskQueue, type QueueItem } from './components/TaskQueue';
import { ActivityFeed } from './components/ActivityFeed';
import { ResultPanel } from './components/ResultPanel';
import { ReceiptPanel } from './components/ReceiptPanel';
import { RegisterAgent } from './components/RegisterAgent';
import { PlanApproval, type PendingPlan } from './components/PlanApproval';
import { VaultActivity } from './components/VaultActivity';
import { VaultPanel } from './components/VaultPanel';
import { WalletPanel } from './components/WalletPanel';
import { AgentsPage } from './components/AgentsPage';
import { FinancialPage } from './components/FinancialPage';
import { TaskHistory } from './components/TaskHistory';
import { BotDetailsModal } from './components/BotDetailsModal';
import { QueueReviewModal, type QueueConfirmItem } from './components/QueueReviewModal';
import { ToastContainer } from './components/Toast';
import { WalletProvider, useWallet } from './contexts/WalletProvider';
import { OrchestratorProvider, useOrchestrator } from './contexts/OrchestratorProvider';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ConnectWallet } from './components/ConnectWallet';
import { CreateOrchestrator } from './components/CreateOrchestrator';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchVaultAccount } from './lib/vault-client';
import { submitTask, forceCompleteVaultTask } from './lib/api';

type Page = 'run' | 'financial' | 'agents' | 'history' | 'register';

const STUCK_WARN_MS  = 5  * 60 * 1000;
const STUCK_FORCE_MS = 30 * 60 * 1000;

const NAV: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'run',       label: 'Run',       icon: <Zap size={12} /> },
  { id: 'financial', label: 'Financial', icon: <Shield size={12} /> },
  { id: 'agents',    label: 'Agents',    icon: <Bot size={12} /> },
  { id: 'history',   label: 'History',   icon: <History size={12} /> },
  { id: 'register',  label: 'Register',  icon: <PlusCircle size={12} /> },
];

// ── Stuck banner ──────────────────────────────────────────────────────────────

function StuckBanner({ stuckMs, vaultTaskId, onForceComplete, onDismiss }: {
  stuckMs: number; vaultTaskId: number | null;
  onForceComplete: () => void; onDismiss: () => void;
}) {
  const showForce = stuckMs >= STUCK_FORCE_MS && vaultTaskId != null;
  return (
    <div className="border-t border-amber-900/40 bg-amber-950/40 px-4 py-2 flex items-center gap-3">
      <AlertTriangle size={11} className="text-amber-400 shrink-0" />
      <p className="text-xs text-amber-300 flex-1">
        No progress for {Math.floor(stuckMs / 60000)} min.
        {showForce && ' Unlock vault balance?'}
      </p>
      {showForce && (
        <button onClick={onForceComplete}
          className="text-xs px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-600 text-white transition-colors shrink-0">
          Force Complete
        </button>
      )}
      <button onClick={onDismiss} className="text-amber-700 hover:text-amber-500 shrink-0"><X size={11} /></button>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard() {
  const { publicKey, disconnect } = useWallet();
  const { orchestrator } = useOrchestrator();
  const { addToast } = useToast();

  const [page, setPage]             = useState<Page>('run');
  const [isRunning, setIsRunning]   = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [openFundVault, setOpenFundVault] = useState(false);
  const [hasResult, setHasResult]   = useState(false);
  const [showBotModal, setShowBotModal] = useState(false);
  const [showQueueReview, setShowQueueReview] = useState(false);

  // Task queue
  const [taskQueue, setTaskQueue]   = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = taskQueue;

  // Stable ref to vault balance so interval callbacks see the latest value
  const vaultBalanceRef = useRef<number | null>(null);
  vaultBalanceRef.current = vaultBalance;

  // Stuck task
  const [vaultTaskId, setVaultTaskId]       = useState<number | null>(null);
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null);
  const [stuckMs, setStuckMs]               = useState(0);
  const [stuckDismissed, setStuckDismissed] = useState(false);
  const stuckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const WS_URL = `ws://${window.location.host}/ws`;
  const { events, connected, clearEvents } = useWebSocket(WS_URL);

  // Vault balance poll
  useEffect(() => {
    if (!publicKey) return;
    const doFetch = () =>
      fetchVaultAccount(publicKey).then(a => setVaultBalance(a?.available ?? 0)).catch(() => {});
    doFetch();
    const t = setInterval(doFetch, 10_000);
    return () => clearInterval(t);
  }, [publicKey]);

  // Stuck timer
  useEffect(() => {
    if (!isRunning || !lastProgressAt) {
      if (stuckRef.current) clearInterval(stuckRef.current);
      setStuckMs(0);
      return;
    }
    stuckRef.current = setInterval(() => setStuckMs(Date.now() - lastProgressAt), 10_000);
    return () => { if (stuckRef.current) clearInterval(stuckRef.current); };
  }, [isRunning, lastProgressAt]);


  // Advance the queue: mark an item done (or a specific item failed), then start countdown for next queued item.
  const advanceQueue = useCallback((failedId?: string, failReason?: string) => {
    setTaskQueue(prev => {
      const updated = failedId
        ? prev.map(i => i.id === failedId ? { ...i, status: 'failed' as const, failReason } : i)
        : prev.map(i => i.status === 'running' ? { ...i, status: 'done' as const } : i);
      const next = updated.find(i => i.status === 'queued');
      if (next) {
        return updated.map(i => i.id === next.id
          ? { ...i, status: 'countdown' as const, scheduled_run_at: Date.now() + i.delay_ms }
          : i
        );
      }
      return updated;
    });
  }, []);

  const doSubmit = useCallback(async (task: string, budget: number, queueItemId?: string) => {
    setIsRunning(true);
    setHasResult(false);
    setStuckDismissed(false);
    setLastProgressAt(Date.now());
    clearEvents();
    try {
      const r = await submitTask(task, budget, publicKey ?? undefined);
      if (r?.error === 'insufficient_vault_balance') {
        setIsRunning(false);
        setLastProgressAt(null);
        addToast('Insufficient vault balance.', 'error');
        if (queueItemId) advanceQueue(queueItemId, 'Insufficient vault balance');
      }
    } catch {
      setIsRunning(false);
      setLastProgressAt(null);
      if (queueItemId) advanceQueue(queueItemId, 'Task submission failed');
    }
  }, [publicKey, clearEvents, addToast, advanceQueue]);

  // Stable ref so the countdown interval always calls the latest doSubmit / advanceQueue / addToast
  const queueTickRef = useRef<() => void>(() => {});
  queueTickRef.current = () => {
    const q = queueRef.current;
    const bal = vaultBalanceRef.current;
    const due = q.find(i => i.status === 'countdown' && i.scheduled_run_at && i.scheduled_run_at <= Date.now());
    if (!due) return;

    // Pre-flight vault balance check before dispatching
    if (bal !== null && bal < due.budget) {
      const reason = `Insufficient balance ($${bal.toFixed(2)} available, $${due.budget.toFixed(2)} needed)`;
      addToast(`Scheduled task skipped — ${reason}`, 'error');
      advanceQueue(due.id, reason);
      return;
    }

    setTaskQueue(prev => prev.map(i => i.id === due.id ? { ...i, status: 'running' } : i));
    doSubmit(due.task, due.budget, due.id);
  };

  // Queue countdown checker — ticks every 500ms, uses ref so closure is always fresh
  useEffect(() => {
    const t = setInterval(() => queueTickRef.current(), 500);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WS event reactions
  useEffect(() => {
    const e = events[0];
    if (!e) return;

    if (['task_complete', 'task_error', 'task_result', 'task_infeasible'].includes(e.event)) {
      setIsRunning(false);
      setVaultTaskId(null);
      setLastProgressAt(null);
      setStuckDismissed(false);
      advanceQueue(); // mark running item done, start next countdown
    }
    if (['task_started', 'step_started', 'step_complete', 'plan_approved', 'plan_auto_approved'].includes(e.event)) {
      setLastProgressAt(Date.now());
      setStuckMs(0);
      setStuckDismissed(false);
    }
    if (e.event === 'plan_approval_required') setPendingPlan(e.data as PendingPlan);
    if (['plan_approved', 'plan_rejected', 'plan_auto_approved'].includes(e.event)) setPendingPlan(null);
    if (e.event === 'budget_locked') setVaultTaskId(e.data?.contract_task_id ?? null);

    if (e.event === 'task_result') {
      setHasResult(true);
      const r = e.data;
      if (r?.status === 'complete')
        addToast(`Done — $${r.total_cost?.toFixed(4)} USDC spent`, 'success');
      else if (r?.status === 'partial')
        addToast('Partially completed — some steps failed', 'warning');
    }
    if (e.event === 'task_error')
      addToast(`Task failed: ${e.data?.error ?? 'unknown'}`, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const handleSubmit = (task: string, budget: number) => doSubmit(task, budget);

  const handleForceComplete = async () => {
    if (!publicKey || vaultTaskId == null) return;
    try {
      await forceCompleteVaultTask(publicKey, vaultTaskId);
      addToast('Force-complete submitted — vault balance will unlock shortly.', 'success');
      setIsRunning(false); setVaultTaskId(null); setLastProgressAt(null);
    } catch (err: any) {
      addToast(`Force-complete failed: ${err.message}`, 'error');
    }
  };

  const handleQueueAdd = (task: string, budget: number, delay_ms: number) => {
    setTaskQueue(prev => [...prev, {
      id: makeId(), task, budget, delay_ms, status: 'queued',
    }]);
  };

  const handleQueueUpdate = (id: string, task: string, budget: number, delay_ms: number) => {
    setTaskQueue(prev => prev.map(i => i.id === id ? { ...i, task, budget, delay_ms } : i));
  };

  const handleQueueRemove = (id: string) => {
    setTaskQueue(prev => prev.filter(i => i.id !== id));
  };

  const handleQueueClearDone = () => {
    setTaskQueue(prev => prev.filter(i => i.status !== 'done' && i.status !== 'failed'));
  };

  // Called when user confirms the queue review modal.
  // confirmed carries potentially-edited task text/budget for each selected item.
  const handleQueueConfirm = (confirmed: QueueConfirmItem[]) => {
    setShowQueueReview(false);
    const confirmedIds = new Set(confirmed.map(c => c.id));
    const edits = new Map(confirmed.map(c => [c.id, c]));
    setTaskQueue(prev => {
      // Drop deselected queued items; apply edits to retained items
      const updated = prev
        .filter(i => i.status !== 'queued' || confirmedIds.has(i.id))
        .map(i => {
          const edit = edits.get(i.id);
          if (!edit) return i;
          return { ...i, task: edit.task, budget: edit.budget };
        });
      // Start countdown for the first queued item if none active
      const alreadyActive = updated.some(i => i.status === 'running' || i.status === 'countdown');
      if (alreadyActive) return updated;
      const firstQueued = updated.find(i => i.status === 'queued');
      if (!firstQueued) return updated;
      return updated.map(i =>
        i.id === firstQueued.id
          // First task fires immediately — no delay waiting
          ? { ...i, status: 'countdown' as const, scheduled_run_at: Date.now() }
          : i
      );
    });
  };

  const showStuck = isRunning && !stuckDismissed && stuckMs >= STUCK_WARN_MS;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur-xl border-b border-gray-800/80 shrink-0">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-3 h-12">

          {/* Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 bg-gradient-to-br from-purple-600 to-purple-800 rounded-md flex items-center justify-center">
              <Layers size={11} className="text-white" />
            </div>
            <span className="text-sm font-bold text-white">CleverCon</span>
          </div>

          {/* Status */}
          {isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-950/60 border border-amber-900/60 text-xs text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {orchestrator?.name ?? 'Agent'} working
            </div>
          )}
          {pendingPlan && !isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-950/60 border border-purple-900/60 text-xs text-purple-400">
              <Zap size={9} className="animate-pulse" />
              Plan ready
            </div>
          )}
          {taskQueue.some(i => i.status === 'countdown') && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-950/60 border border-blue-900/60 text-xs text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Next task queued
            </div>
          )}

          {/* Vault chip — clickable shortcut */}
          {vaultBalance !== null && (
            <button
              onClick={() => setPage('financial')}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-800/60 text-xs text-purple-300 hover:bg-purple-950/80 transition-colors"
            >
              <Shield size={9} className="text-purple-500" />
              <span className="font-mono font-semibold">${vaultBalance.toFixed(2)}</span>
              <span className="text-purple-600 text-xs">USDC</span>
            </button>
          )}

          <div className="flex-1" />

          {/* Nav */}
          <nav className="hidden sm:flex items-center gap-0.5">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  page === n.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                {n.icon}
                {n.label}
                {n.id === 'run' && hasResult && !isRunning && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </nav>

          {/* WS + wallet */}
          <div className="flex items-center gap-2 pl-3 border-l border-gray-800 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
            {publicKey && (
              <>
                <span className="text-xs text-gray-600 font-mono hidden md:block">{publicKey.slice(0, 4)}…{publicKey.slice(-4)}</span>
                <button onClick={disconnect} title="Disconnect" className="text-gray-700 hover:text-gray-400 transition-colors">
                  <LogOut size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {showStuck && (
          <StuckBanner
            stuckMs={stuckMs}
            vaultTaskId={vaultTaskId}
            onForceComplete={handleForceComplete}
            onDismiss={() => setStuckDismissed(true)}
          />
        )}
      </header>

      {/* ── Pages ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-screen-xl w-full mx-auto px-4 py-6">

        {/* ── RUN ─────────────────────────────────────────────────────────── */}
        {page === 'run' && (
          <div className="flex flex-col gap-5">

            {/* Main 3-col */}
            <div className="grid grid-cols-12 gap-4 items-start">

              {/* Left: task controls */}
              <div className="col-span-12 lg:col-span-4 space-y-3">
                <TaskInput
                  onSubmit={handleSubmit}
                  isRunning={isRunning}
                  orchestratorName={orchestrator?.name ?? 'CleverCon'}
                  onFundVault={() => setOpenFundVault(true)}
                  onBotClick={() => setShowBotModal(true)}
                />
                <TaskQueue
                  items={taskQueue}
                  vaultAvailable={vaultBalance}
                  onAdd={handleQueueAdd}
                  onUpdate={handleQueueUpdate}
                  onRemove={handleQueueRemove}
                  onClearDone={handleQueueClearDone}
                  onRunQueue={() => setShowQueueReview(true)}
                />
              </div>

              {/* Center: live feed + results below */}
              <div className="col-span-12 lg:col-span-5 space-y-4">
                <ActivityFeed
                  events={events}
                  connected={connected}
                  onClear={clearEvents}
                  orchestratorName={orchestrator?.name ?? 'Agent'}
                />
                {hasResult && (
                  <>
                    <ResultPanel events={events} />
                    <ReceiptPanel events={events} />
                  </>
                )}
              </div>

              {/* Right: vault + wallet + vault activity */}
              <div className="col-span-12 lg:col-span-3 space-y-4">
                <VaultPanel
                  forceOpenFund={openFundVault}
                  onFundOpened={() => setOpenFundVault(false)}
                  onDepositSuccess={() => addToast('Deposit confirmed.', 'success')}
                  onWithdrawSuccess={() => addToast('Withdrawal confirmed.', 'success')}
                  onError={msg => addToast(msg, 'error')}
                />
                <WalletPanel />
                <VaultActivity events={events} />
              </div>
            </div>

          </div>
        )}

        {/* ── FINANCIAL ───────────────────────────────────────────────────── */}
        {page === 'financial' && <FinancialPage />}

        {/* ── AGENTS ──────────────────────────────────────────────────────── */}
        {page === 'agents' && (
          <AgentsPage onRegisterClick={() => setPage('register')} />
        )}

        {/* ── HISTORY ─────────────────────────────────────────────────────── */}
        {page === 'history' && <TaskHistory />}

        {/* ── REGISTER ────────────────────────────────────────────────────── */}
        {page === 'register' && (
          <div className="max-w-2xl mx-auto">
            <RegisterAgent />
          </div>
        )}
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {pendingPlan && (
        <PlanApproval
          plan={pendingPlan}
          onDismiss={() => setPendingPlan(null)}
          orchestratorName={orchestrator?.name ?? 'Your Agent'}
        />
      )}

      {showBotModal && orchestrator && (
        <BotDetailsModal
          name={orchestrator.name}
          pubkey={orchestrator.pubkey}
          registered={orchestrator.registered_on_chain ?? false}
          onClose={() => setShowBotModal(false)}
        />
      )}

      {showQueueReview && (
        <QueueReviewModal
          items={taskQueue.filter(i => i.status === 'queued')}
          vaultAvailable={vaultBalance}
          orchestratorName={orchestrator?.name ?? 'CleverCon'}
          onFundVault={() => { setShowQueueReview(false); setOpenFundVault(true); }}
          onConfirm={handleQueueConfirm}
          onClose={() => setShowQueueReview(false)}
        />
      )}

      <ToastContainer />
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

function AppInner() {
  const { isConnected, isLoading: walletLoading } = useWallet();
  const { orchestrator, isLoading: orchLoading } = useOrchestrator();

  if (walletLoading || (isConnected && orchLoading)) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isConnected) return <ConnectWallet />;
  if (!orchestrator) return <CreateOrchestrator />;
  return <Dashboard />;
}

export default function App() {
  return (
    <WalletProvider>
      <OrchestratorProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </OrchestratorProvider>
    </WalletProvider>
  );
}
