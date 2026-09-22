import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Vault as VaultIcon,
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
  SlidersHorizontal,
} from 'lucide-react';
import { isDemo } from '../../config';
import { getVault } from '../../lib/vault';
import { getServices } from '../../lib/services';
import { getPolicies, createPolicy, type Policy } from '../../lib/policies';
import {
  getTasks,
  createTask,
  createPayment,
  planInstruction,
  type HireMode,
} from '../../lib/tasks';
import { Card, CardHeader, EmptyState, controls } from '../../components/ui';
import { LimitsBuilder } from './limits';
import {
  describeRules,
  describeSavedLimit,
  draftToRules,
  emptyDraft,
  getDefaultLimitId,
  LIMIT_CACHE_PREFIX,
  type Draft,
} from './limits-model';

const inputCls = controls.field;
const primaryBtn = controls.primary;
const chipBtn = controls.chip;

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

/**
 * Compact budget strip. The agent's spendable budget is important context, but
 * secondary to the command surface below, so it reads as a slim status bar, not a
 * hero. Full funding, the wallet link, and the locked breakdown live on the Vault
 * tab (linked here).
 */
function VaultStrip() {
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const available = vault?.available ?? 0;
  const balance = vault?.balance ?? 0;
  const locked = vault?.locked ?? 0;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/15">
          <VaultIcon size={16} />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-white">
              ${available.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">available to spend</span>
          </div>
          <div className="truncate text-xs text-slate-500">
            ${balance.toFixed(2)} in vault · ${locked.toFixed(2)} locked by active jobs
          </div>
        </div>
      </div>
      <Link to="/app/vault" className={chipBtn}>
        Fund / manage
      </Link>
    </Card>
  );
}

// ── Command / chat: instruct the agent, review a plan, approve ──────────────────

// The limit the vault will enforce for one instruction, resolved to a short label.
type Applied = { label: string; isPrivate: boolean };
// How that limit binds to the task: an existing saved limit (policyId), an ad-hoc
// custom rule (draft, saved-and-bound on approval), or nothing (budget only).
type Bind = { policyId?: string; draft?: Draft };
type Line = { payee: string; amount: string; reason: string };
type PlanLine = { payee: string; amount: number; reason?: string };
type Plan = {
  kind: 'pay' | 'disburse' | 'hire';
  summary: string;
  lines: PlanLine[];
  limit: Applied;
  bind: Bind;
  serviceName?: string;
  serviceId?: string;
};
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'plan'; plan: Plan; status: 'pending' | 'approved' | 'cancelled' }
  | { id: number; role: 'agent'; text: string; ok?: boolean };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const hasRule = (d: Draft) => !!d.perPaymentCeiling || !!d.rollingCap || d.allowlist.length > 0;

// 'default' = the owner's default (or budget-only if none); 'custom' = the builder
// below; 'none' = budget-only; otherwise a saved limit's id.
type LimitChoice = 'default' | 'custom' | 'none' | string;

export function CommandChat() {
  const qc = useQueryClient();
  const idRef = useRef(2);
  const nextId = () => idRef.current++;
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 1,
      role: 'agent',
      text: "I'm your spending agent. Tell me what to do with your budget, or use a quick action. I'll propose a plan and you approve before anything moves. The vault enforces the limit you pick, so I can never overspend or pay outside your rules.",
    },
  ]);

  const [action, setAction] = useState<'pay' | 'disburse' | 'hire' | null>(null);
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '', reason: '' }]);
  const [serviceId, setServiceId] = useState('');
  const [budget, setBudget] = useState('');

  // Limit for the next instruction. Sticky across instructions (not reset after send).
  const [limitChoice, setLimitChoice] = useState<LimitChoice>('default');
  const [customDraft, setCustomDraft] = useState<Draft>(emptyDraft());

  // Natural-language box: the agent parses it into a plan you then approve.
  const [nl, setNl] = useState('');

  const { data: servicePage } = useQuery({
    queryKey: ['services', { picker: true }],
    queryFn: () => getServices({ limit: 100 }),
  });
  const services = servicePage?.items ?? [];
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const defaultPolicy = policies.find((p) => p.id === getDefaultLimitId());

  // Resolve the current selection to (a) what the vault enforces, and (b) how it binds.
  const resolvedPolicyId =
    limitChoice === 'default'
      ? defaultPolicy?.id
      : limitChoice === 'custom' || limitChoice === 'none'
        ? undefined
        : limitChoice;

  const applied: Applied = (() => {
    if (limitChoice === 'custom')
      return {
        label: describeRules(draftToRules(customDraft).rules),
        isPrivate: customDraft.isPrivate,
      };
    if (limitChoice === 'none') return { label: 'within budget only', isPrivate: false };
    const p: Policy | undefined =
      limitChoice === 'default' ? defaultPolicy : policies.find((x) => x.id === limitChoice);
    if (p) return { label: describeSavedLimit(p), isPrivate: p.isPrivate };
    return { label: 'within budget only', isPrivate: false };
  })();

  const hire = useMutation({
    mutationFn: (p: { title: string; serviceId: string; budget: number; policyId?: string }) =>
      createTask({
        title: p.title,
        mode: 'DIRECT' as HireMode,
        budget: p.budget,
        serviceId: p.serviceId,
        policyId: p.policyId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const pay = useMutation({
    mutationFn: (p: {
      kind: 'pay' | 'disburse';
      lines: { payee: string; amount: number; reason?: string }[];
      policyId?: string;
    }) => createPayment({ kind: p.kind, lines: p.lines, policyId: p.policyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['vault'] });
    },
  });

  const planMut = useMutation({
    mutationFn: (instruction: string) => planInstruction(instruction),
  });

  // Send the typed instruction to the agent; it returns a plan you then approve.
  async function askAgent() {
    const instruction = nl.trim();
    if (!instruction) return;
    push({ id: nextId(), role: 'user', text: instruction });
    setNl('');
    let result: Awaited<ReturnType<typeof planInstruction>>;
    try {
      result = await planMut.mutateAsync(instruction);
    } catch (e) {
      push({
        id: nextId(),
        role: 'agent',
        ok: false,
        text: e instanceof Error ? e.message : 'The agent could not respond.',
      });
      return;
    }
    const bind = currentBind();
    if (result.kind === 'hire' && result.service) {
      push({
        id: nextId(),
        role: 'plan',
        status: 'pending',
        plan: {
          kind: 'hire',
          summary: `Hire ${result.service.name} (budget $${result.budget.toFixed(2)})`,
          lines: [{ payee: result.service.name, amount: result.budget, reason: 'service' }],
          limit: applied,
          bind,
          serviceName: result.service.name,
          serviceId: result.service.id,
        },
      });
    } else if ((result.kind === 'pay' || result.kind === 'disburse') && result.lines.length) {
      const lines = result.lines.map((l) => ({
        payee: l.payee,
        amount: l.amount,
        reason: l.reason,
      }));
      const total = lines.reduce((s, l) => s + l.amount, 0);
      push({
        id: nextId(),
        role: 'plan',
        status: 'pending',
        plan: {
          kind: result.kind,
          summary:
            result.kind === 'pay'
              ? `Pay ${short(lines[0].payee)} $${lines[0].amount.toFixed(2)}`
              : `Disburse $${total.toFixed(2)} to ${lines.length} recipient${lines.length > 1 ? 's' : ''}`,
          lines,
          limit: applied,
          bind,
        },
      });
    } else {
      push({ id: nextId(), role: 'agent', ok: false, text: result.rationale });
    }
    if (result.warnings.length) {
      push({ id: nextId(), role: 'agent', text: result.warnings.join(' ') });
    }
  }

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

  function currentBind(): Bind {
    if (limitChoice === 'custom') return hasRule(customDraft) ? { draft: customDraft } : {};
    return { policyId: resolvedPolicyId };
  }

  function propose() {
    if (!action) return;
    const bind = currentBind();
    let plan: Plan | null = null;
    let userText = '';
    if (action === 'pay') {
      const amt = Number(amount);
      if (!payee.trim() || !(amt > 0)) return;
      plan = {
        kind: 'pay',
        summary: `Pay ${short(payee.trim())} $${amt.toFixed(2)}`,
        lines: [{ payee: payee.trim(), amount: amt, reason: reason.trim() || undefined }],
        limit: applied,
        bind,
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
        limit: applied,
        bind,
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
        limit: applied,
        bind,
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

  // Turn the plan's binding into a concrete policy id: an existing saved limit, or
  // a fresh policy created from an ad-hoc custom rule (so custom limits bind too).
  async function resolveBinding(bind: Bind): Promise<string | undefined> {
    if (bind.policyId) return bind.policyId;
    if (bind.draft && hasRule(bind.draft)) {
      const { rules, isPrivate } = draftToRules(bind.draft);
      const p = await createPolicy(rules, isPrivate);
      if (isPrivate) {
        try {
          localStorage.setItem(LIMIT_CACHE_PREFIX + p.commitment, JSON.stringify(bind.draft));
        } catch {
          // ignore
        }
      }
      qc.invalidateQueries({ queryKey: ['policies'] });
      return p.id;
    }
    return undefined;
  }

  async function approve(id: number, plan: Plan) {
    setPlanStatus(id, 'approved');
    if (plan.kind === 'hire' && plan.serviceId) {
      try {
        const policyId = await resolveBinding(plan.bind);
        await hire.mutateAsync({
          title: `Hire ${plan.serviceName}`,
          serviceId: plan.serviceId,
          budget: plan.lines[0].amount,
          policyId,
        });
        push({
          id: nextId(),
          role: 'agent',
          ok: true,
          text: `Hired ${plan.serviceName}${policyId ? ' under your limit' : ''}. The job is running; watch it in Activity.`,
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
    // pay / disburse: a real, policy-bounded release from the vault.
    if (plan.kind !== 'pay' && plan.kind !== 'disburse') return;
    const kind = plan.kind;
    try {
      const policyId = await resolveBinding(plan.bind);
      await pay.mutateAsync({
        kind,
        lines: plan.lines.map((l) => ({ payee: l.payee, amount: l.amount, reason: l.reason })),
        policyId,
      });
      const total = plan.lines.reduce((s, l) => s + l.amount, 0);
      push({
        id: nextId(),
        role: 'agent',
        ok: true,
        text: `Sent $${total.toFixed(2)} across ${plan.lines.length} payment${plan.lines.length > 1 ? 's' : ''}${plan.limit.isPrivate ? ', with your rule kept private' : ''}. Each is a proof-gated vault release; watch it settle in Activity.`,
      });
    } catch (e) {
      push({
        id: nextId(),
        role: 'agent',
        ok: false,
        text: e instanceof Error ? e.message : 'Could not send the payment. Please try again.',
      });
    }
  }

  return (
    <Card className="p-0">
      <CardHeader
        icon={Sparkles}
        title="Tell your agent what to do"
        hint="It proposes a plan; you approve; the vault enforces the limit you pick"
      />
      <div className="p-5">
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
        <div className="mt-4 border-t border-line pt-4">
          {/* Natural language: the agent parses it into a plan you approve. */}
          <div className="flex gap-2">
            <input
              value={nl}
              onChange={(e) => setNl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), askAgent())}
              placeholder="Tell your agent in words, e.g. pay G… $5 for design, or split $9 between two addresses"
              className={inputCls}
            />
            <button
              onClick={askAgent}
              disabled={!nl.trim() || planMut.isPending}
              className={primaryBtn}
            >
              {planMut.isPending ? 'Thinking…' : 'Ask agent'}
            </button>
          </div>
          <div className="mb-2 mt-2 text-[11px] uppercase tracking-wider text-slate-600">
            or use a quick action
          </div>

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
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
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
                        className="rounded-lg bg-white/[0.05] px-2 text-slate-500 hover:text-red-300"
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

              {/* One clear limit control for this instruction */}
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500">
                    <SlidersHorizontal size={13} className="text-violet-300" /> Limit for this
                    instruction
                  </span>
                  <select
                    value={limitChoice}
                    onChange={(e) => setLimitChoice(e.target.value)}
                    className="min-w-[15rem] flex-1 rounded-lg bg-black/30 px-2 py-1.5 text-sm text-slate-100 outline-none"
                    aria-label="Limit for this instruction"
                  >
                    <option value="default">
                      {defaultPolicy
                        ? `Default limit · ${describeSavedLimit(defaultPolicy)}`
                        : 'Budget only (no extra limit)'}
                    </option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.isPrivate ? 'Private' : 'Transparent'} · {describeSavedLimit(p)}
                      </option>
                    ))}
                    <option value="custom">Custom limit for this instruction…</option>
                    {defaultPolicy && <option value="none">No limit (within budget only)</option>}
                  </select>
                  <Link
                    to="/app/limits"
                    className="text-xs text-violet-300 hover:text-violet-200"
                    title="Create and manage reusable limits"
                  >
                    Manage limits
                  </Link>
                </div>

                {limitChoice === 'custom' && (
                  <div className="mt-3 rounded-lg bg-black/20 p-3">
                    <LimitsBuilder value={customDraft} onChange={setCustomDraft} />
                    <p className="mt-3 text-[11px] text-slate-600">
                      This one-off limit is saved and bound to this task when you approve. To reuse
                      it later, it will appear in your{' '}
                      <Link to="/app/limits" className="text-violet-300 hover:text-violet-200">
                        Limits
                      </Link>{' '}
                      tab.
                    </p>
                  </div>
                )}

                <p className="mt-2 text-[11px] text-slate-500">
                  The vault will enforce: <span className="text-slate-300">{applied.label}</span>
                  {applied.isPrivate ? ' · rule kept private' : ' · transparent'}.
                </p>
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={propose} className={primaryBtn}>
                  Propose to agent
                </button>
                <button onClick={resetComposer} className={controls.secondary}>
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
        <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-sm text-slate-300">
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
          <span className="inline-flex items-center gap-1 text-violet-300">
            {plan.limit.isPrivate ? <EyeOff size={11} /> : <Eye size={11} />} limit:{' '}
            {plan.limit.label}
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
              className="rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
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
      <div className="p-5">
        {!isLoading && shown.length === 0 && (
          <EmptyState>Nothing yet. Instruct your agent above to get going.</EmptyState>
        )}
        <div className="space-y-2">
          {shown.map((t) => (
            <Link
              key={t.id}
              to={`/app/tasks/${t.id}`}
              className="flex items-center justify-between rounded-xl bg-surface p-3 transition-colors hover:bg-surface-2"
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

/**
 * First-run activation guide. The chat-first Home has no obvious on-ramp for a
 * brand-new user, so this walks them from an empty vault to their first
 * instruction: fund, (optionally) set a limit, then tell the agent. It reads the
 * same cached queries the rest of Home uses (no extra fetches), highlights the
 * step you are on, and retires itself the moment you have any activity. Dismissible.
 */
function FirstRunGuide() {
  const { data: vault } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('cc:home:guide') === 'off',
  );

  // In demo mode the vault is pre-funded with sample activity, so the guide is
  // irrelevant; and once a real user has done anything, the on-ramp is over.
  if (isDemo() || dismissed || tasks.length > 0) return null;

  const funded = (vault?.balance ?? 0) > 0;
  const steps = [
    {
      done: funded,
      label: 'Fund your vault',
      desc: 'Deposit USDC your agent can spend. Non-custodial: the platform never touches it.',
      cta: 'Fund',
      to: '/app/vault',
    },
    {
      done: policies.length > 0,
      label: 'Set a spending limit',
      desc: 'A private cap and allowlist the vault enforces. Optional: you can also set one per instruction.',
      cta: 'Add a limit',
      to: '/app/limits',
    },
    {
      done: false,
      label: 'Tell your agent what to do',
      desc: 'Type an instruction below (or pick a quick action). You approve the plan; the vault enforces it.',
      cta: null,
      to: null,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles size={15} className="text-violet-300" /> Get started
        </span>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem('cc:home:guide', 'off');
            setDismissed(true);
          }}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Dismiss
        </button>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
              i === current ? 'bg-violet-500/[0.08]' : 'bg-white/[0.02]'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                s.done
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : i === current
                    ? 'bg-violet-500/20 text-violet-200'
                    : 'bg-white/5 text-slate-500'
              }`}
            >
              {s.done ? <Check size={14} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${s.done ? 'text-slate-500 line-through' : 'text-white'}`}>
                {s.label}
              </div>
              {!s.done && <div className="mt-0.5 text-xs text-slate-500">{s.desc}</div>}
            </div>
            {!s.done && s.to && (
              <Link to={s.to} className={`${chipBtn} shrink-0`}>
                {s.cta}
                <ArrowRight size={13} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Home() {
  return (
    <div className="space-y-6">
      {/* Command-first: the agent prompt + quick actions are the subject of the
          page; the budget is a compact strip above it, funding lives on Vault. */}
      <VaultStrip />
      <CommandChat />
      <FirstRunGuide />
      <RecentActivity />
    </div>
  );
}
