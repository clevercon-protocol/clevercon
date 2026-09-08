import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Search,
  UserCheck,
  Workflow,
  Star,
  ListChecks,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  Plus,
  Vault as VaultIcon,
  Coins,
  Briefcase,
} from 'lucide-react';
import { isDemo } from '../config';
import { useSession } from '../store/session';
import { demoCategories } from '../lib/demo';
import { getServices } from '../lib/services';
import { getVault, getVaultStatus, depositToVault, withdrawFromVault } from '../lib/vault';
import { getTasks, createTask, type HireMode } from '../lib/tasks';
import { getPolicies, createPolicy } from '../lib/policies';
import { getWalletBalances, addUsdcTrustline, explorerAccount } from '../lib/stellar';
import { Card, CardHeader, PageHeader, StatCard, EmptyState, Badge } from '../components/ui';

type Mode = 'direct' | 'search' | 'compose';

const MODES: { id: Mode; icon: typeof UserCheck; label: string; blurb: string }[] = [
  {
    id: 'direct',
    icon: UserCheck,
    label: 'Pay a provider',
    blurb: 'You already know who to hire, so it is one bounded, private payment.',
  },
  {
    id: 'search',
    icon: Search,
    label: 'Find & pay one',
    blurb: 'Describe what you need; pick from matching providers and pay.',
  },
  {
    id: 'compose',
    icon: Workflow,
    label: 'Compose a job',
    blurb: 'A multi-service job where a delegate plans steps and pays per step.',
  },
];

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-500/40';
const primaryBtn =
  'rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all';

const explorerContract = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

/** Pull a readable message out of an API or wallet error (which is often not an Error). */
function readError(e: unknown): string {
  let raw = '';
  if (e instanceof Error) raw = e.message;
  else if (typeof e === 'string') raw = e;
  else if (e && typeof e === 'object' && 'message' in e)
    raw = String((e as { message: unknown }).message);
  if (!raw) return 'The wallet or network rejected the transaction. Please try again.';
  // apiFetch throws `API <status>: <json body>`; surface the JSON message.
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.message) return String(parsed.message);
    } catch {
      // fall through to the raw message
    }
  }
  return raw;
}

/**
 * Refresh vault + wallet balances now and again after a short delay: an on-chain
 * change can take a few seconds to reflect in Horizon and the indexed mirror, so
 * one immediate refetch may still read the pre-transaction state.
 */
function refreshBalancesSoon(qc: ReturnType<typeof useQueryClient>) {
  const bump = () => {
    qc.invalidateQueries({ queryKey: ['vault'] });
    qc.invalidateQueries({ queryKey: ['wallet-balances'] });
  };
  bump();
  setTimeout(bump, 4000);
  setTimeout(bump, 9000);
}

const VAULT_HINTS: Record<string, string> = {
  Balance: 'Total USDC held in the vault for you (deposits minus withdrawals).',
  Available: 'Balance minus locked. This is what you can withdraw or spend right now.',
  Locked: 'Reserved by active jobs. Released back to available when a job finishes.',
};

const STATUS_TINT: Record<string, string> = {
  RUNNING: 'text-sky-300',
  PENDING: 'text-amber-300',
  COMPLETED: 'text-emerald-300',
  RELEASED: 'text-emerald-300',
  CONFIRMED: 'text-emerald-300',
  DRAFT: 'text-slate-400',
  CANCELLED: 'text-slate-500',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
};

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatsRow() {
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const address = useSession((s) => s.session?.address ?? '');
  const { data: bal } = useQuery({
    queryKey: ['wallet-balances', address],
    queryFn: () => getWalletBalances(address),
    enabled: !isDemo() && !!address,
  });
  const activeJobs = tasks.filter((t) => t.status === 'RUNNING' || t.status === 'PENDING').length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={VaultIcon}
        accent="violet"
        label="Vault balance"
        value={`$${(vault?.balance ?? 0).toFixed(2)}`}
      />
      <StatCard
        icon={Coins}
        accent="emerald"
        label="Available"
        value={`$${(vault?.available ?? 0).toFixed(2)}`}
      />
      <StatCard
        icon={Wallet}
        accent="sky"
        label="Wallet USDC"
        value={isDemo() ? 'n/a' : bal?.usdc != null ? `$${bal.usdc.toFixed(2)}` : 'None'}
      />
      <StatCard icon={Briefcase} accent="amber" label="Active jobs" value={activeJobs} />
    </div>
  );
}

// ── Wallet ────────────────────────────────────────────────────────────────────

function WalletCard() {
  const qc = useQueryClient();
  const address = useSession((s) => s.session?.address ?? '');
  const [copied, setCopied] = useState(false);
  const {
    data: bal,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['wallet-balances', address],
    queryFn: () => getWalletBalances(address),
    enabled: !!address,
  });

  const trust = useMutation({
    mutationFn: () => addUsdcTrustline(address),
    onSuccess: () => refreshBalancesSoon(qc),
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-300">
            <Wallet size={15} />
          </div>
          <span className="font-mono text-xs text-slate-400">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-slate-500 hover:text-white"
            aria-label="Copy address"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <a
            href={explorerAccount(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-white"
            aria-label="View on explorer"
          >
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">XLM</div>
            <div className="font-mono text-sm font-semibold text-emerald-300">
              {isLoading ? '…' : (bal?.xlm ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">USDC</div>
            {isLoading ? (
              <div className="font-mono text-sm">…</div>
            ) : bal?.usdc != null ? (
              <div className="font-mono text-sm font-semibold text-sky-300">
                {bal.usdc.toFixed(2)}
              </div>
            ) : (
              <div className="text-xs italic text-slate-500">No trustline</div>
            )}
          </div>
        </div>
        {bal && bal.funded && bal.usdc == null && (
          <button
            onClick={() => trust.mutate()}
            disabled={trust.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-sky-900/50 bg-sky-950/30 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-950/50 disabled:opacity-50"
          >
            {trust.isPending ? '…' : <Plus size={12} />}
            {trust.isPending ? 'Adding…' : 'Add USDC trustline'}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-400">Could not load wallet balances from Horizon.</p>
      )}
      {trust.error && <p className="mt-2 text-xs text-red-400">{readError(trust.error)}</p>}
      {!isLoading && bal && !bal.funded && (
        <p className="mt-2 text-xs text-amber-300">
          This wallet is not funded on testnet yet. Fund it, then reload.
        </p>
      )}
    </Card>
  );
}

// ── Vault ─────────────────────────────────────────────────────────────────────

function VaultCard() {
  const qc = useQueryClient();
  // Poll the vault (a cheap DB read) so a deposit/withdraw shows up on its own
  // once the indexer mirrors it, without a manual reload. One observer polls;
  // the shared cache updates the stat row too.
  const {
    data: vault,
    isLoading,
    error,
  } = useQuery({ queryKey: ['vault'], queryFn: getVault, refetchInterval: 12_000 });
  const { data: status } = useQuery({ queryKey: ['vault-status'], queryFn: getVaultStatus });
  const [amount, setAmount] = useState('');
  const rows: [string, number, string][] = [
    ['Balance', vault?.balance ?? 0, 'text-white'],
    ['Available', vault?.available ?? 0, 'text-emerald-300'],
    ['Locked', vault?.locked ?? 0, 'text-amber-300'],
  ];

  const move = useMutation({
    mutationFn: (kind: 'deposit' | 'withdraw') =>
      kind === 'deposit' ? depositToVault(Number(amount)) : withdrawFromVault(Number(amount)),
    onSuccess: () => {
      setAmount('');
      // Both the vault mirror and the wallet balance change (funds move between
      // wallet and vault); refresh both, allowing for propagation lag.
      refreshBalancesSoon(qc);
    },
  });

  const amountNum = Number(amount);
  const canMove = amount !== '' && Number.isFinite(amountNum) && amountNum > 0 && !move.isPending;
  const enabled = status?.depositsEnabled ?? false;
  const contract = status?.contractAddress;

  return (
    <Card className="p-0">
      <CardHeader
        icon={VaultIcon}
        title="Your vault"
        hint="On-chain balance, mirrored"
        action={
          contract ? (
            <a
              href={explorerContract(contract)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-slate-400 hover:text-white"
              title={contract}
            >
              {contract.slice(0, 4)}…{contract.slice(-4)} <ExternalLink size={11} />
            </a>
          ) : undefined
        }
      />
      <div className="p-5 pt-4">
        {error && <p className="mb-3 text-sm text-red-400">Could not load your vault.</p>}
        <div className="grid grid-cols-3 gap-3">
          {rows.map(([label, v, tint]) => (
            <div
              key={label}
              title={VAULT_HINTS[label]}
              className="cursor-help rounded-xl border border-white/[0.08] bg-black/20 p-3 text-center"
            >
              <div className={`text-lg font-bold ${tint}`}>
                {isLoading ? '…' : `$${v.toFixed(2)}`}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                {label} USDC
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Balance held in the vault. Available = balance minus what active jobs have locked.
        </p>

        {enabled ? (
          <div className="mt-4">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Amount (USDC)"
              className={inputCls}
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => canMove && move.mutate('deposit')}
                disabled={!canMove}
                className={`flex-1 ${primaryBtn}`}
              >
                {move.isPending ? 'Signing…' : 'Deposit'}
              </button>
              <button
                onClick={() => canMove && move.mutate('withdraw')}
                disabled={!canMove}
                className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>
            {move.error && <p className="mt-2 text-sm text-red-400">{readError(move.error)}</p>}
            {move.isSuccess && (
              <p className="mt-2 text-sm text-emerald-300">
                Submitted. Your balance updates once the deposit is indexed.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-slate-500">
            On-chain deposits are not enabled in this environment.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Hire ──────────────────────────────────────────────────────────────────────

function HirePanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('direct');
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('');
  const [serviceId, setServiceId] = useState('');
  const active = MODES.find((m) => m.id === mode)!;
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: getServices });

  const hire = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        mode: mode.toUpperCase() as HireMode,
        budget: Number(budget),
        serviceId: mode === 'direct' ? serviceId || undefined : undefined,
      }),
    onSuccess: () => {
      setTitle('');
      setBudget('');
      setServiceId('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const budgetNum = Number(budget);
  const canSubmit =
    title.trim().length > 0 &&
    budget !== '' &&
    Number.isFinite(budgetNum) &&
    budgetNum > 0 &&
    (mode !== 'direct' || serviceId !== '') &&
    !hire.isPending;

  return (
    <Card className="p-0">
      <CardHeader icon={Briefcase} title="Hire a service" hint="Create a bounded, private job" />
      <div className="p-5 pt-4">
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm transition-colors ${mode === m.id ? 'border-violet-500/40 bg-violet-500/10 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}
            >
              <m.icon size={16} className="mx-auto mb-1" />
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-400">{active.blurb}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) hire.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === 'direct' ? 'What is this payment for?' : 'Describe the job'}
            className={inputCls}
          />
          {mode === 'direct' && (
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose a provider…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (${s.pricePerCall}/call)
                </option>
              ))}
            </select>
          )}
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
            placeholder="Budget (USDC)"
            className={inputCls}
          />
          <button type="submit" disabled={!canSubmit} className={primaryBtn}>
            {hire.isPending ? 'Creating…' : 'Create job'}
          </button>
          {hire.error && <p className="text-sm text-red-400">Could not create the job.</p>}
          {hire.isSuccess && (
            <p className="text-sm text-emerald-300">Job created. It appears in Your jobs below.</p>
          )}
        </form>
      </div>
    </Card>
  );
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

function TasksCard() {
  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  return (
    <Card className="p-0">
      <CardHeader icon={ListChecks} title="Your jobs" />
      <div className="p-5 pt-4">
        {isLoading && <p className="text-sm text-slate-500">Loading jobs…</p>}
        {error && <p className="text-sm text-red-400">Could not load your jobs.</p>}
        {!isLoading && !error && tasks.length === 0 && (
          <EmptyState>No jobs yet. Hire a service to get started.</EmptyState>
        )}
        <div className="space-y-2">
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/app/tasks/${t.id}`}
              className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 hover:border-violet-500/40 hover:bg-white/[0.04] transition-colors"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="text-xs text-slate-500">
                  {t.mode} · {t.completedSteps}/{t.stepCount} steps · ${t.spent.toFixed(2)} of $
                  {t.budget.toFixed(2)}
                </div>
              </div>
              <span
                className={`ml-3 shrink-0 text-xs ${STATUS_TINT[t.status] ?? 'text-slate-400'}`}
              >
                {t.status}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Policies ──────────────────────────────────────────────────────────────────

function PoliciesCard() {
  const qc = useQueryClient();
  const [ceiling, setCeiling] = useState('');
  const [cap, setCap] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const {
    data: policies = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });

  const save = useMutation({
    mutationFn: () =>
      createPolicy(
        {
          perPaymentCeilingUsdc: ceiling ? Number(ceiling) : undefined,
          rollingCapUsdc: cap ? Number(cap) : undefined,
          rollingWindowSecs: cap ? 86400 : undefined,
        },
        isPrivate,
      ),
    onSuccess: () => {
      setCeiling('');
      setCap('');
      qc.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  const hasRule = Number(ceiling) > 0 || Number(cap) > 0;
  const canSave = hasRule && !save.isPending;

  return (
    <Card className="p-0">
      <CardHeader
        icon={ShieldCheck}
        title="Spending policies"
        hint="Bound how funds can be spent"
      />
      <div className="p-5 pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          <input
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            inputMode="decimal"
            placeholder="Per-payment ceiling (USDC)"
            className={inputCls}
          />
          <input
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            inputMode="decimal"
            placeholder="Daily cap (USDC)"
            className={inputCls}
          />
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private (zero-knowledge)
          </label>
          <button type="submit" disabled={!canSave} className={primaryBtn}>
            {save.isPending ? 'Saving…' : 'Create policy'}
          </button>
        </form>
        {save.error && (
          <p className="mt-2 text-sm text-amber-300">
            Private policies are not enabled yet. Uncheck it to save a transparent policy for now.
          </p>
        )}
        {isLoading && <p className="mt-4 text-sm text-slate-500">Loading policies…</p>}
        {error && <p className="mt-4 text-sm text-red-400">Could not load your policies.</p>}
        {!isLoading && !error && policies.length === 0 && (
          <div className="mt-4">
            <EmptyState>No policies yet.</EmptyState>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {policies.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm"
            >
              <div>
                <span className="text-slate-200">
                  {p.isPrivate ? 'Private' : 'Transparent'} policy
                </span>
                {p.rules && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p.rules.perPaymentCeilingUsdc != null &&
                      `ceiling $${p.rules.perPaymentCeilingUsdc} `}
                    {p.rules.rollingCapUsdc != null && `· daily cap $${p.rules.rollingCapUsdc}`}
                  </div>
                )}
              </div>
              <span className="font-mono text-[11px] text-slate-500">
                {p.commitment.slice(0, 10)}…
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Marketplace ───────────────────────────────────────────────────────────────

function Marketplace() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['services'], queryFn: getServices });

  const results = useMemo(
    () =>
      services.filter(
        (s) =>
          (cat === 'All' || s.category === cat) &&
          (q === '' ||
            s.name.toLowerCase().includes(q.toLowerCase()) ||
            s.description.toLowerCase().includes(q.toLowerCase())),
      ),
    [services, q, cat],
  );

  return (
    <Card className="p-0">
      <CardHeader icon={Search} title="Marketplace" hint="Hire AI agents, humans, and businesses" />
      <div className="p-5 pt-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search services…"
            className={`min-w-48 flex-1 ${inputCls}`}
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className={`w-auto ${inputCls}`}
          >
            <option>All</option>
            {demoCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {isLoading && <p className="mt-4 text-sm text-slate-500">Loading services…</p>}
        {error && <p className="mt-4 text-sm text-red-400">Could not load services.</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {results.map((s) => (
            <Link
              key={s.id}
              to={`/app/marketplace/${s.id}`}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 hover:border-violet-500/40 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <Badge className="border-amber-500/25 bg-amber-500/10 text-amber-300">
                  <Star size={11} /> {s.rating.toFixed(1)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">{s.description}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {s.category} · {s.provider}
                </span>
                <span className="text-slate-300">${s.pricePerCall}/call</span>
              </div>
            </Link>
          ))}
          {!isLoading && !error && results.length === 0 && (
            <p className="text-sm text-slate-500">No services match.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function Buyer() {
  return (
    <section className="space-y-6">
      <PageHeader
        title="Buyer console"
        subtitle="Fund a vault, hire services, and keep your spending rules private."
      />
      <StatsRow />
      {!isDemo() && <WalletCard />}
      <div className="grid gap-6 lg:grid-cols-2">
        <VaultCard />
        <HirePanel />
      </div>
      <TasksCard />
      <PoliciesCard />
      <Marketplace />
    </section>
  );
}
