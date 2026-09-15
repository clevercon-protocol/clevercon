import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Vault as VaultIcon,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  EyeOff,
  Eye,
  UserCheck,
  Users,
  Briefcase,
  Check,
  X,
  Plus,
  Trash2,
  ListChecks,
  ArrowRight,
} from 'lucide-react';
import { isDemo } from '../../config';
import { useSession } from '../../store/session';
import { getVault } from '../../lib/vault';
import { getServices } from '../../lib/services';
import { getTasks, createTask, type HireMode } from '../../lib/tasks';
import { explorerAccount } from '../../lib/stellar';
import { Card, CardHeader, EmptyState } from '../../components/ui';

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-500/40';
const primaryBtn =
  'rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all';
const chipBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/40 hover:text-white transition-colors';

const STATUS_TINT: Record<string, string> = {
  RUNNING: 'text-sky-300',
  PENDING: 'text-amber-300',
  COMPLETED: 'text-emerald-300',
  DRAFT: 'text-slate-400',
  CANCELLED: 'text-slate-500',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
};

// ── Vault hero: the money the agent can spend is the main number ────────────────

export function VaultHero() {
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const address = useSession((s) => s.session?.address ?? '');
  const available = vault?.available ?? 0;
  const balance = vault?.balance ?? 0;
  const locked = vault?.locked ?? 0;
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500">
            <VaultIcon size={13} className="text-violet-300" /> Your agent&apos;s budget
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-bold text-white">${available.toFixed(2)}</span>
            <span className="pb-1 text-sm text-slate-500">available to spend</span>
          </div>
          <div className="mt-1 text-sm text-slate-400">
            ${balance.toFixed(2)} in vault, ${locked.toFixed(2)} locked by active jobs
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link to="/app/vault" className={primaryBtn}>
            Fund / manage
          </Link>
          {!isDemo() && address && (
            <a
              href={explorerAccount(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-slate-300"
              title="Your personal wallet (funding source)"
            >
              wallet {address.slice(0, 4)}…{address.slice(-4)} <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Command / chat: instruct the agent, review a plan, approve ──────────────────

type Constraints = { isPrivate: boolean; perPaymentCap: string; mode: 'caps' | 'allowlist' };
type Line = { payee: string; amount: string; reason: string };
type PlanLine = { payee: string; amount: number; reason?: string };
type Plan = {
  kind: 'pay' | 'disburse' | 'hire';
  summary: string;
  lines: PlanLine[];
  constraints: Constraints;
  serviceName?: string;
  serviceId?: string;
};
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'plan'; plan: Plan; status: 'pending' | 'approved' | 'cancelled' }
  | { id: number; role: 'agent'; text: string; ok?: boolean };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function CommandChat() {
  const qc = useQueryClient();
  const idRef = useRef(2);
  const nextId = () => idRef.current++;
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 1,
      role: 'agent',
      text: "I'm your spending agent. Tell me what to do with your budget, or use a quick action. I'll propose a plan and you approve before anything moves. The vault enforces your limits, so I can never overspend or pay outside your rules.",
    },
  ]);

  const [action, setAction] = useState<'pay' | 'disburse' | 'hire' | null>(null);
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '', reason: '' }]);
  const [serviceId, setServiceId] = useState('');
  const [budget, setBudget] = useState('');
  const [cons, setCons] = useState<Constraints>({
    isPrivate: true,
    perPaymentCap: '',
    mode: 'caps',
  });

  const { data: servicePage } = useQuery({
    queryKey: ['services', { picker: true }],
    queryFn: () => getServices({ limit: 100 }),
  });
  const services = servicePage?.items ?? [];

  const hire = useMutation({
    mutationFn: (p: { title: string; serviceId: string; budget: number }) =>
      createTask({
        title: p.title,
        mode: 'DIRECT' as HireMode,
        budget: p.budget,
        serviceId: p.serviceId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  function resetComposer() {
    setAction(null);
    setPayee('');
    setAmount('');
    setReason('');
    setLines([{ payee: '', amount: '', reason: '' }]);
    setServiceId('');
    setBudget('');
  }

  function push(...msgs: Msg[]) {
    setMessages((m) => [...m, ...msgs]);
  }

  function propose() {
    if (!action) return;
    let plan: Plan | null = null;
    let userText = '';
    if (action === 'pay') {
      const amt = Number(amount);
      if (!payee.trim() || !(amt > 0)) return;
      plan = {
        kind: 'pay',
        summary: `Pay ${short(payee.trim())} $${amt.toFixed(2)}`,
        lines: [{ payee: payee.trim(), amount: amt, reason: reason.trim() || undefined }],
        constraints: cons,
      };
      userText = `Pay $${amt.toFixed(2)} to ${short(payee.trim())}${reason.trim() ? ` for ${reason.trim()}` : ''}.`;
    } else if (action === 'disburse') {
      const valid = lines
        .map((l) => ({
          payee: l.payee.trim(),
          amount: Number(l.amount),
          reason: l.reason.trim() || undefined,
        }))
        .filter((l) => l.payee && l.amount > 0);
      if (valid.length === 0) return;
      const total = valid.reduce((s, l) => s + l.amount, 0);
      plan = {
        kind: 'disburse',
        summary: `Disburse $${total.toFixed(2)} to ${valid.length} recipient${valid.length > 1 ? 's' : ''}`,
        lines: valid,
        constraints: cons,
      };
      userText = `Disburse to ${valid.length} recipients (total $${total.toFixed(2)}), varying amounts.`;
    } else if (action === 'hire') {
      const svc = services.find((s) => s.id === serviceId);
      const bud = Number(budget);
      if (!svc || !(bud > 0)) return;
      plan = {
        kind: 'hire',
        summary: `Hire ${svc.name} (budget $${bud.toFixed(2)})`,
        lines: [{ payee: svc.name, amount: bud, reason: 'service' }],
        constraints: cons,
        serviceName: svc.name,
        serviceId: svc.id,
      };
      userText = `Hire ${svc.name} with a $${bud.toFixed(2)} budget.`;
    }
    if (!plan) return;
    push(
      { id: nextId(), role: 'user', text: userText },
      { id: nextId(), role: 'plan', plan, status: 'pending' },
    );
    resetComposer();
  }

  function setPlanStatus(id: number, status: 'approved' | 'cancelled') {
    setMessages((m) => m.map((x) => (x.role === 'plan' && x.id === id ? { ...x, status } : x)));
  }

  async function approve(id: number, plan: Plan) {
    setPlanStatus(id, 'approved');
    if (plan.kind === 'hire' && plan.serviceId) {
      try {
        await hire.mutateAsync({
          title: `Hire ${plan.serviceName}`,
          serviceId: plan.serviceId,
          budget: plan.lines[0].amount,
        });
        push({
          id: nextId(),
          role: 'agent',
          ok: true,
          text: `Hired ${plan.serviceName}. The job is running; watch it in Activity.`,
        });
      } catch {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: `Could not create the job. Please try again.`,
        });
      }
      return;
    }
    // pay / disburse: the release primitive is not wired yet (Phase 1). Preview honestly.
    const total = plan.lines.reduce((s, l) => s + l.amount, 0);
    push({
      id: nextId(),
      role: 'agent',
      ok: true,
      text: `Preview: this would release $${total.toFixed(2)} across ${plan.lines.length} payment${plan.lines.length > 1 ? 's' : ''}${plan.constraints.isPrivate ? ', with your rule kept private' : ''}, each checked against your limits on-chain. Live payments land when the pay/disburse primitive is wired (Phase 1).`,
    });
  }

  return (
    <Card className="p-0">
      <CardHeader
        icon={Sparkles}
        title="Tell your agent what to do"
        hint="It proposes a plan; you approve; the vault enforces your limits"
      />
      <div className="p-5 pt-4">
        {/* Transcript */}
        <div className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              msg={m}
              onApprove={approve}
              onCancel={(id) => setPlanStatus(id, 'cancelled')}
            />
          ))}
        </div>

        {/* Composer */}
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setAction('pay')}
              className={`${chipBtn} ${action === 'pay' ? 'border-violet-500/50 text-white' : ''}`}
            >
              <UserCheck size={14} /> Pay an address
            </button>
            <button
              onClick={() => setAction('disburse')}
              className={`${chipBtn} ${action === 'disburse' ? 'border-violet-500/50 text-white' : ''}`}
            >
              <Users size={14} /> Disburse to a list
            </button>
            <button
              onClick={() => setAction('hire')}
              className={`${chipBtn} ${action === 'hire' ? 'border-violet-500/50 text-white' : ''}`}
            >
              <Briefcase size={14} /> Hire a service
            </button>
          </div>

          {action && (
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              {action === 'pay' && (
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
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
                    placeholder="Amount USDC"
                    className={inputCls}
                  />
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className={`${inputCls} sm:col-span-2`}
                  />
                </div>
              )}
              {action === 'disburse' && (
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]">
                      <input
                        value={l.payee}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, payee: e.target.value } : x)),
                          )
                        }
                        placeholder="Payee (G…)"
                        className={inputCls}
                      />
                      <input
                        value={l.amount}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                          )
                        }
                        inputMode="decimal"
                        placeholder="Amount"
                        className={inputCls}
                      />
                      <input
                        value={l.reason}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)),
                          )
                        }
                        placeholder="Reason"
                        className={inputCls}
                      />
                      <button
                        onClick={() =>
                          setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))
                        }
                        className="rounded-lg border border-white/10 px-2 text-slate-500 hover:text-red-300"
                        aria-label="Remove row"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setLines((ls) => [...ls, { payee: '', amount: '', reason: '' }])}
                    className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                  >
                    <Plus size={12} /> Add recipient
                  </button>
                </div>
              )}
              {action === 'hire' && (
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                  <select
                    value={serviceId}
                    onChange={(e) => setServiceId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Choose a service…</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (${s.pricePerCall}/call)
                      </option>
                    ))}
                  </select>
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    inputMode="decimal"
                    placeholder="Budget USDC"
                    className={inputCls}
                  />
                </div>
              )}

              {/* Per-instruction constraints */}
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3 text-xs text-slate-400">
                <span className="uppercase tracking-wider text-slate-500">
                  Limits for this instruction
                </span>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={cons.isPrivate}
                    onChange={(e) => setCons((c) => ({ ...c, isPrivate: e.target.checked }))}
                  />
                  {cons.isPrivate ? (
                    <EyeOff size={13} className="text-violet-300" />
                  ) : (
                    <Eye size={13} />
                  )}{' '}
                  Private
                </label>
                <label className="inline-flex items-center gap-1.5">
                  Max per payment
                  <input
                    value={cons.perPaymentCap}
                    onChange={(e) =>
                      setCons((c) => ({
                        ...c,
                        perPaymentCap: e.target.value.replace(/[^0-9.]/g, ''),
                      }))
                    }
                    inputMode="decimal"
                    placeholder="none"
                    className="w-20 rounded border border-white/10 bg-black/30 px-2 py-1 text-slate-100 outline-none"
                  />
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <select
                    value={cons.mode}
                    onChange={(e) =>
                      setCons((c) => ({ ...c, mode: e.target.value as Constraints['mode'] }))
                    }
                    className="rounded border border-white/10 bg-black/30 px-2 py-1 text-slate-100 outline-none"
                  >
                    <option value="caps">Any address, within caps</option>
                    <option value="allowlist">Only listed addresses</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={propose} className={primaryBtn}>
                  Propose to agent
                </button>
                <button
                  onClick={resetComposer}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ChatBubble({
  msg,
  onApprove,
  onCancel,
}: {
  msg: Msg;
  onApprove: (id: number, plan: Plan) => void;
  onCancel: (id: number) => void;
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-500/15 px-3 py-2 text-sm text-slate-100">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === 'agent') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
          {msg.text}
        </div>
      </div>
    );
  }
  // plan
  const { plan } = msg;
  const total = plan.lines.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-violet-500/25 bg-violet-500/[0.05] p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <ShieldCheck size={15} className="text-violet-300" /> Proposed plan: {plan.summary}
        </div>
        <div className="mt-2 space-y-1">
          {plan.lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-black/20 px-2.5 py-1.5 text-xs"
            >
              <span className="font-mono text-slate-300">
                {plan.kind === 'hire' ? l.payee : short(l.payee)}
              </span>
              <span className="text-slate-400">
                ${l.amount.toFixed(2)}
                {l.reason ? <span className="ml-2 text-slate-600">{l.reason}</span> : null}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>total ${total.toFixed(2)}</span>
          <span>{plan.constraints.isPrivate ? 'rule kept private' : 'transparent'}</span>
          {plan.constraints.perPaymentCap && (
            <span>cap ${plan.constraints.perPaymentCap}/payment</span>
          )}
          <span>
            {plan.constraints.mode === 'allowlist'
              ? 'only listed addresses'
              : 'any address within caps'}
          </span>
        </div>
        {msg.status === 'pending' ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onApprove(msg.id, plan)}
              className={`${primaryBtn} !px-3 !py-1.5`}
            >
              <Check size={13} className="mr-1 inline" /> Approve
            </button>
            <button
              onClick={() => onCancel(msg.id)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              <X size={13} className="mr-1 inline" /> Cancel
            </button>
          </div>
        ) : (
          <div
            className={`mt-2 text-xs ${msg.status === 'approved' ? 'text-emerald-300' : 'text-slate-500'}`}
          >
            {msg.status === 'approved' ? 'Approved' : 'Cancelled'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recent activity (a unified ledger of what the agent did) ────────────────────

export function RecentActivity() {
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const shown = tasks.slice(0, 6);
  return (
    <Card className="p-0">
      <CardHeader
        icon={ListChecks}
        title="Recent activity"
        action={
          tasks.length > 6 ? (
            <Link
              to="/app/activity"
              className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
            >
              View all <ArrowRight size={12} />
            </Link>
          ) : undefined
        }
      />
      <div className="p-5 pt-4">
        {!isLoading && shown.length === 0 && (
          <EmptyState>Nothing yet. Instruct your agent above to get going.</EmptyState>
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
                  {t.mode} · ${t.spent.toFixed(2)} of ${t.budget.toFixed(2)}
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

// ── The home page: budget on top, command in the middle, activity below ─────────

export function Home() {
  return (
    <div className="space-y-6">
      <VaultHero />
      <CommandChat />
      <RecentActivity />
    </div>
  );
}
