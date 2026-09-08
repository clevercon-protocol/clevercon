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
} from 'lucide-react';
import { isDemo } from '../config';
import { useSession } from '../store/session';
import { demoCategories } from '../lib/demo';
import { getServices } from '../lib/services';
import { getVault, getVaultStatus, depositToVault, withdrawFromVault } from '../lib/vault';
import { getTasks, createTask, type HireMode } from '../lib/tasks';
import { getPolicies, createPolicy } from '../lib/policies';
import { getWalletBalances, addUsdcTrustline, explorerAccount } from '../lib/stellar';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet-balances', address] }),
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
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

        <div className="flex items-center gap-5">
          <div>
            <div className="text-xs text-slate-500">XLM</div>
            <div className="font-mono text-sm font-semibold text-emerald-300">
              {isLoading ? '…' : (bal?.xlm ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">USDC</div>
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
      {trust.error && (
        <p className="mt-2 text-xs text-red-400">Trustline transaction failed or was rejected.</p>
      )}
      {!isLoading && bal && !bal.funded && (
        <p className="mt-2 text-xs text-amber-300">
          This wallet is not funded on testnet yet. Fund it, then reload.
        </p>
      )}
    </div>
  );
}

function VaultCard() {
  const qc = useQueryClient();
  const { data: vault, isLoading, error } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: status } = useQuery({ queryKey: ['vault-status'], queryFn: getVaultStatus });
  const [amount, setAmount] = useState('');
  const rows: [string, number][] = [
    ['Balance', vault?.balance ?? 0],
    ['Available', vault?.available ?? 0],
    ['Locked', vault?.locked ?? 0],
  ];

  const move = useMutation({
    mutationFn: (kind: 'deposit' | 'withdraw') =>
      kind === 'deposit' ? depositToVault(Number(amount)) : withdrawFromVault(Number(amount)),
    onSuccess: () => {
      setAmount('');
      qc.invalidateQueries({ queryKey: ['vault'] });
    },
  });

  const amountNum = Number(amount);
  const canMove = amount !== '' && Number.isFinite(amountNum) && amountNum > 0 && !move.isPending;
  const enabled = status?.depositsEnabled ?? false;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Wallet size={18} className="text-violet-300" />
        <h2 className="font-semibold">Your vault</h2>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">Could not load your vault.</p>}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {rows.map(([label, v]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center"
          >
            <div className="text-lg font-bold">{isLoading ? '…' : `$${v.toFixed(2)}`}</div>
            <div className="text-xs text-slate-500">{label} USDC</div>
          </div>
        ))}
      </div>

      {enabled ? (
        <div className="mt-4">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount (USDC)"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => canMove && move.mutate('deposit')}
              disabled={!canMove}
              className="flex-1 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
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
          {move.error && (
            <p className="mt-2 text-sm text-red-400">Transaction failed or rejected.</p>
          )}
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
  );
}

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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Hire a service</h2>
      <div className="mt-4 flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${mode === m.id ? 'border-violet-500/40 bg-violet-500/10 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}
          >
            <m.icon size={16} className="mx-auto mb-1" />
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-400">{active.blurb}</p>

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
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        {mode === 'direct' && (
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
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
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {hire.isPending ? 'Creating…' : 'Create job'}
        </button>
        {hire.error && <p className="text-sm text-red-400">Could not create the job.</p>}
        {hire.isSuccess && (
          <p className="text-sm text-emerald-300">
            Job created as a draft. It appears in Your jobs below.
          </p>
        )}
      </form>
    </div>
  );
}

const STATUS_TINT: Record<string, string> = {
  RUNNING: 'text-sky-300',
  PENDING: 'text-amber-300',
  COMPLETED: 'text-emerald-300',
  DRAFT: 'text-slate-400',
  CANCELLED: 'text-slate-500',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
};

function TasksCard() {
  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <ListChecks size={18} className="text-violet-300" />
        <h2 className="font-semibold">Your jobs</h2>
      </div>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading jobs…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load your jobs.</p>}
      {!isLoading && !error && tasks.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No jobs yet. Hire a service to get started.</p>
      )}
      <div className="mt-4 space-y-2">
        {tasks.map((t) => (
          <Link
            key={t.id}
            to={`/app/tasks/${t.id}`}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-violet-500/40 hover:bg-white/[0.04]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="text-xs text-slate-500">
                {t.mode} · {t.completedSteps}/{t.stepCount} steps · ${t.spent.toFixed(2)} of $
                {t.budget.toFixed(2)}
              </div>
            </div>
            <span className={`ml-3 shrink-0 text-xs ${STATUS_TINT[t.status] ?? 'text-slate-400'}`}>
              {t.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <ShieldCheck size={18} className="text-violet-300" />
        <h2 className="font-semibold">Spending policies</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Bound how funds can be spent. Transparent mode stores the rule; private (zero-knowledge)
        mode is coming with the proving layer.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
        className="mt-4 grid sm:grid-cols-2 gap-2"
      >
        <input
          value={ceiling}
          onChange={(e) => setCeiling(e.target.value)}
          inputMode="decimal"
          placeholder="Per-payment ceiling (USDC)"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <input
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          inputMode="decimal"
          placeholder="Daily cap (USDC)"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          Private (zero-knowledge)
        </label>
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
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
        <p className="mt-4 text-sm text-slate-500">No policies yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {policies.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">
                {p.isPrivate ? 'Private' : 'Transparent'} policy
              </span>
              <span className="font-mono text-xs text-slate-500">{p.commitment.slice(0, 10)}…</span>
            </div>
            {p.rules && (
              <div className="mt-1 text-xs text-slate-500">
                {p.rules.perPaymentCeilingUsdc != null &&
                  `ceiling $${p.rules.perPaymentCeilingUsdc} `}
                {p.rules.rollingCapUsdc != null && `· daily cap $${p.rules.rollingCapUsdc}`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Marketplace() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['services'], queryFn: getServices });

  const results = useMemo(() => {
    return services.filter(
      (s) =>
        (cat === 'All' || s.category === cat) &&
        (q === '' ||
          s.name.toLowerCase().includes(q.toLowerCase()) ||
          s.description.toLowerCase().includes(q.toLowerCase())),
    );
  }, [services, q, cat]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Marketplace</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search services…"
          className="flex-1 min-w-48 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        >
          <option>All</option>
          {demoCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading services…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load services.</p>}
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {results.map((s) => (
          <Link
            key={s.id}
            to={`/app/marketplace/${s.id}`}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-violet-500/40 hover:bg-white/[0.04]"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                <Star size={12} /> {s.rating.toFixed(1)}
              </span>
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
  );
}

export function Buyer() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Buyer console</h1>
        <p className="mt-1 text-slate-400">
          Fund a vault, hire services, and keep your spending rules private.
        </p>
      </div>
      {!isDemo() && <WalletCard />}
      <div className="grid lg:grid-cols-2 gap-6">
        <VaultCard />
        <HirePanel />
      </div>
      <TasksCard />
      <PoliciesCard />
      <Marketplace />
    </section>
  );
}
