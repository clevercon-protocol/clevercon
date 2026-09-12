import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  CheckCircle2,
  ExternalLink,
  Plus,
  Vault as VaultIcon,
  Coins,
  Briefcase,
  ArrowRight,
  Rocket,
  KeyRound,
  Eye,
  EyeOff,
  Fingerprint,
} from 'lucide-react';
import { isDemo } from '../../config';
import { useSession } from '../../store/session';
import { demoCategories } from '../../lib/demo';
import { getServices, type ServiceSort } from '../../lib/services';
import {
  getVault,
  getVaultStatus,
  depositToVault,
  withdrawFromVault,
  getDelegate,
  authorizeDelegate,
} from '../../lib/vault';
import { getTasks, createTask, type HireMode } from '../../lib/tasks';
import {
  getPolicies,
  createPolicy,
  requestProof,
  getProofStatus,
  type Policy,
} from '../../lib/policies';
import { getWalletBalances, addUsdcTrustline, explorerAccount } from '../../lib/stellar';
import { getApiKeys } from '../../lib/apiKeys';
import { Card, CardHeader, StatCard, EmptyState, Badge } from '../../components/ui';

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
 * change can take a few seconds to reflect in Horizon and the indexed mirror.
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

export function StatsRow() {
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

export function WalletCard() {
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

export function VaultCard() {
  const qc = useQueryClient();
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
                Submitted. Your balance updates automatically in a few seconds.
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

export function HirePanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('direct');
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const activeMode = MODES.find((m) => m.id === mode)!;
  const { data: servicePage } = useQuery({
    queryKey: ['services', { picker: true }],
    queryFn: () => getServices({ limit: 100 }),
  });
  const services = servicePage?.items ?? [];
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });

  const hire = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        mode: mode.toUpperCase() as HireMode,
        budget: Number(budget),
        serviceId: mode === 'direct' ? serviceId || undefined : undefined,
        policyId: policyId || undefined,
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
      <CardHeader icon={Briefcase} title="Start a job" hint="Create a bounded, private payment" />
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
        <p className="mt-3 text-sm text-slate-400">{activeMode.blurb}</p>
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
          {policies.length > 0 && (
            <select
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className={inputCls}
              aria-label="Spending policy"
            >
              <option value="">No policy (off-chain only)</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isPrivate ? 'Private' : 'Transparent'} policy {p.commitment.slice(0, 8)}…
                </option>
              ))}
            </select>
          )}
          <button type="submit" disabled={!canSubmit} className={primaryBtn}>
            {hire.isPending ? 'Creating…' : 'Create job'}
          </button>
          {hire.error && <p className="text-sm text-red-400">Could not create the job.</p>}
          {hire.isSuccess && <p className="text-sm text-emerald-300">Job created.</p>}
        </form>
      </div>
    </Card>
  );
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export function TasksCard({ limit }: { limit?: number }) {
  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <Card className="p-0">
      <CardHeader
        icon={ListChecks}
        title="Your jobs"
        action={
          limit && tasks.length > limit ? (
            <Link
              to="/app/jobs"
              className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
            >
              View all <ArrowRight size={12} />
            </Link>
          ) : undefined
        }
      />
      <div className="p-5 pt-4">
        {isLoading && <p className="text-sm text-slate-500">Loading jobs…</p>}
        {error && <p className="text-sm text-red-400">Could not load your jobs.</p>}
        {!isLoading && !error && tasks.length === 0 && (
          <EmptyState>No jobs yet. Start one to get going.</EmptyState>
        )}
        <div className="space-y-2">
          {shown.map((t) => (
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

export function PoliciesCard() {
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
        {isPrivate && (
          <p className="mt-2 text-xs text-slate-500">
            Private policies store only a commitment. The rule itself is never sent to or kept by
            the server; releases are authorized with a zero-knowledge binding proof.
          </p>
        )}
        {save.error && (
          <p className="mt-2 text-sm text-red-400">
            Could not create the policy. Please try again.
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
                <span className="inline-flex items-center gap-1.5 text-slate-200">
                  {p.isPrivate ? <ShieldCheck size={13} className="text-violet-300" /> : null}
                  {p.isPrivate ? 'Private' : 'Transparent'} policy
                </span>
                {p.rules ? (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p.rules.perPaymentCeilingUsdc != null &&
                      `ceiling $${p.rules.perPaymentCeilingUsdc} `}
                    {p.rules.rollingCapUsdc != null && `· daily cap $${p.rules.rollingCapUsdc}`}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-slate-500">commitment only, rule hidden</div>
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

// ── Prove a release ─────────────────────────────────────────────────────────────

const PROOF_TINT: Record<string, string> = {
  REQUESTED: 'text-amber-300',
  GENERATING: 'text-sky-300',
  READY: 'text-emerald-300',
  VERIFIED: 'text-emerald-300',
  REJECTED: 'text-red-400',
  FAILED: 'text-red-400',
};

/**
 * Request a zero-knowledge binding proof authorizing a release (payee + amount)
 * under a chosen policy, and watch its status. The worker builds the proof the
 * on-chain verifier checks; this is the proof-gated-release step made visible.
 */
export function ProveReleaseCard() {
  const [policyId, setPolicyId] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [proofId, setProofId] = useState<string | null>(null);

  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });

  const prove = useMutation({
    mutationFn: () => requestProof(policyId, payee.trim(), Number(amount)),
    onSuccess: (r) => setProofId(r.proofId),
  });

  // Poll the proof status until it settles.
  const { data: status } = useQuery({
    queryKey: ['proof', proofId],
    queryFn: () => getProofStatus(proofId as string),
    enabled: !!proofId,
    refetchInterval: (q) => {
      const s = (q.state.data as { status?: string } | undefined)?.status;
      return s === 'READY' || s === 'VERIFIED' || s === 'REJECTED' || s === 'FAILED' ? false : 800;
    },
  });

  const usable = policies.filter((p: Policy) => p.isPrivate);
  const selected = usable.find((p: Policy) => p.id === policyId);
  const revealed = status?.status === 'READY' || status?.status === 'VERIFIED';
  const canProve =
    policyId !== '' && payee.trim().length > 0 && Number(amount) > 0 && !prove.isPending;

  return (
    <Card className="p-0">
      <CardHeader
        icon={ShieldCheck}
        title="Prove a release"
        hint="Authorize a payment with a zero-knowledge proof"
      />
      <div className="p-5 pt-4">
        {usable.length === 0 ? (
          <EmptyState>Create a private policy first to authorize releases with a proof.</EmptyState>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canProve) prove.mutate();
            }}
            className="grid gap-2"
          >
            <select
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className={inputCls}
              aria-label="Policy"
            >
              <option value="">Select a private policy…</option>
              {usable.map((p: Policy) => (
                <option key={p.id} value={p.id}>
                  {p.commitment.slice(0, 10)}… (private)
                </option>
              ))}
            </select>
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Payee address (G…)"
              className={inputCls}
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Amount (USDC)"
              className={inputCls}
            />
            <button type="submit" disabled={!canProve} className={primaryBtn}>
              {prove.isPending ? 'Requesting…' : 'Generate proof'}
            </button>
          </form>
        )}
        {prove.error && <p className="mt-2 text-sm text-red-400">{readError(prove.error)}</p>}
        {proofId && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
            <span className="text-slate-400">Proof status</span>
            <span
              className={`font-medium ${PROOF_TINT[status?.status ?? 'REQUESTED'] ?? 'text-slate-300'}`}
            >
              {status?.status ?? 'REQUESTED'}
              {status?.status === 'READY' && ' · ready to release'}
            </span>
          </div>
        )}
        {revealed && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              What this payment reveals
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Eye size={14} className="text-slate-400" /> On the public ledger
                </div>
                <ul className="mt-2 space-y-1 font-mono text-xs text-slate-400">
                  <li>
                    payment: {Number(amount).toFixed(2)} USDC to {payee.slice(0, 6)}…
                    {payee.slice(-4)}
                  </li>
                  <li className="break-all">
                    policy: {selected ? selected.commitment.slice(0, 18) + '…' : 'n/a'}
                  </li>
                  <li className="text-emerald-300">proof: verified, payment allowed</li>
                </ul>
              </div>
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-violet-200">
                  <EyeOff size={14} /> Stays private
                </div>
                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                  <li>your budget, caps, and allowlist</li>
                  <li>the rule that authorized this payment</li>
                  <li className="flex items-start gap-1.5 text-slate-300">
                    <Fingerprint size={13} className="mt-0.5 shrink-0 text-violet-400" />
                    the chain stores only the commitment, never the rule
                  </li>
                </ul>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              The ledger shows the payment happened and was allowed. The rule behind it is committed
              as a hash and never published. (Amounts and counterparties are public in v1; hiding
              those is on the roadmap.)
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Marketplace ───────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: ServiceSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

const PAGE_SIZE = 12;

export function Marketplace() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  const [sort, setSort] = useState<ServiceSort>('recent');
  const [page, setPage] = useState(0);

  // Debounce the search box so we hit the API once the user pauses, not per key.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter/sort/search change resets to the first page.
  useEffect(() => setPage(0), [debouncedQ, cat, sort]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['services', { q: debouncedQ, cat, sort, page }],
    queryFn: () =>
      getServices({
        q: debouncedQ,
        category: cat,
        sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE + items.length);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

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
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ServiceSort)}
            className={`w-auto ${inputCls}`}
            aria-label="Sort services"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {isLoading && <p className="mt-4 text-sm text-slate-500">Loading services…</p>}
        {error && <p className="mt-4 text-sm text-red-400">Could not load services.</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((s) => (
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
          {!isLoading && !error && items.length === 0 && (
            <p className="text-sm text-slate-500">No services match.</p>
          )}
        </div>
        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
            <span>
              {start}-{end} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!hasPrev || isFetching}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-slate-200 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext || isFetching}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-slate-200 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Delegate authorization (bounded agent) ──────────────────────────────────────

/**
 * One-time authorization of the platform delegate (register_orchestrator). Once
 * authorized, the delegate can lock and pay for jobs within the user's policy
 * without further wallet prompts, and the vault guarantees it can never
 * overspend. Shown only when automatic settlement is enabled server-side.
 */
export function DelegateCard() {
  const qc = useQueryClient();
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });
  const authorize = useMutation({
    mutationFn: authorizeDelegate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delegate'] }),
  });

  if (!delegate?.settlementEnabled || !delegate.orchestrator) return null;

  return (
    <Card className="p-0">
      <CardHeader
        icon={ShieldCheck}
        title="Spending agent"
        hint="Authorize a bounded delegate to pay for jobs within your policy"
      />
      <div className="p-5 pt-4">
        <p className="text-sm text-slate-400">
          Authorize the agent once so it can lock and release funds for your jobs automatically. The
          vault enforces your policy, so even the agent cannot overspend.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-slate-500">
            {delegate.orchestrator.slice(0, 6)}…{delegate.orchestrator.slice(-4)}
          </span>
          {delegate.registered ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
              <Check size={14} /> Authorized
            </span>
          ) : (
            <button
              onClick={() => authorize.mutate()}
              disabled={authorize.isPending}
              className={primaryBtn}
            >
              {authorize.isPending ? 'Authorizing…' : 'Authorize agent'}
            </button>
          )}
        </div>
        {authorize.error && (
          <p className="mt-2 text-sm text-red-400">{readError(authorize.error)}</p>
        )}
        {authorize.isSuccess && !delegate.registered && (
          <p className="mt-2 text-sm text-emerald-300">
            Agent authorized. Jobs can now settle automatically.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Activation funnel (getting started) ─────────────────────────────────────────

const ONBOARDING_HIDDEN_KEY = 'cc:onboarding:hidden';

/**
 * Guided first-run checklist: connect, fund, set a policy, connect an agent, make
 * a bounded payment. Detects progress from live data and points at the next
 * action, so a new buyer reaches their first policy-bounded payment without help.
 * Collapses to a slim confirmation once complete (dismissible).
 */
export function GettingStarted() {
  const session = useSession((s) => s.session);
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: apiKeys = [] } = useQuery({ queryKey: ['apiKeys'], queryFn: getApiKeys });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const [hidden, setHidden] = useState(() => localStorage.getItem(ONBOARDING_HIDDEN_KEY) === '1');

  const steps = [
    {
      icon: Wallet,
      title: 'Connect your wallet',
      desc: 'Sign in with a Stellar wallet to open your account.',
      done: !!session,
      href: '/connect',
      cta: 'Connect',
    },
    {
      icon: VaultIcon,
      title: 'Fund your vault',
      desc: 'Deposit USDC into the non-custodial vault. The platform never holds it.',
      done: (vault?.balance ?? 0) > 0,
      href: '/app/vault',
      cta: 'Fund vault',
    },
    {
      icon: ShieldCheck,
      title: 'Set a spending policy',
      desc: 'A budget and limits the vault enforces on-chain, kept private.',
      done: policies.length > 0,
      href: '/app/policies',
      cta: 'Create policy',
    },
    {
      icon: KeyRound,
      title: 'Connect your agent',
      desc: 'Create an API key (also used in the MCP config) so your agent can spend.',
      done: apiKeys.length > 0,
      href: '/developers',
      cta: 'Create API key',
    },
    {
      icon: Briefcase,
      title: 'Make a bounded payment',
      desc: 'Hire a service; the vault releases payment per step, within your policy.',
      done: tasks.some((t) => t.spent > 0 || t.status === 'COMPLETED'),
      href: '/app/marketplace',
      cta: 'Hire a service',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const currentIndex = steps.findIndex((s) => !s.done);

  if (hidden) return null;

  if (allDone) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-emerald-300">
            <CheckCircle2 size={18} /> Setup complete. Your agent can spend within your policy.
          </div>
          <button
            onClick={() => {
              localStorage.setItem(ONBOARDING_HIDDEN_KEY, '1');
              setHidden(true);
            }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Hide
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <CardHeader
        icon={Rocket}
        title="Get started"
        hint="A few steps to your first bounded, private payment"
        action={
          <span className="text-xs text-slate-500">
            {doneCount}/{steps.length} done
          </span>
        }
      />
      <div className="p-5 pt-4">
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li
                key={s.title}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                  isCurrent
                    ? 'border-violet-500/40 bg-violet-500/[0.06]'
                    : 'border-white/[0.08] bg-white/[0.02]'
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    s.done
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : isCurrent
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'bg-white/5 text-slate-500'
                  }`}
                >
                  {s.done ? <Check size={15} /> : <s.icon size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${s.done ? 'text-slate-400 line-through' : 'text-white'}`}
                  >
                    {s.title}
                  </div>
                  {!s.done && <div className="text-xs text-slate-500">{s.desc}</div>}
                </div>
                {!s.done &&
                  (isCurrent ? (
                    <Link to={s.href} className={`${primaryBtn} shrink-0 whitespace-nowrap`}>
                      {s.cta}
                    </Link>
                  ) : (
                    <Link
                      to={s.href}
                      className="shrink-0 whitespace-nowrap text-xs text-slate-500 hover:text-slate-300"
                    >
                      {s.cta}
                    </Link>
                  ))}
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}

// ── Compact vault summary (for the overview) ────────────────────────────────────

export function VaultSummary() {
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  return (
    <Card className="p-0">
      <CardHeader icon={VaultIcon} title="Vault" hint="Your bounded spending balance" />
      <div className="p-5 pt-4">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold text-white">${(vault?.balance ?? 0).toFixed(2)}</span>
          <span className="pb-1 text-xs text-slate-500">USDC balance</span>
        </div>
        <div className="mt-1 text-sm text-slate-400">
          ${(vault?.available ?? 0).toFixed(2)} available · ${(vault?.locked ?? 0).toFixed(2)}{' '}
          locked
        </div>
        <Link
          to="/app/vault"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          Manage vault <ArrowRight size={14} />
        </Link>
      </div>
    </Card>
  );
}
