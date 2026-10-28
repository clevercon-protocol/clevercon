import { useEffect, useRef, useState } from 'react';
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
  Lock,
} from 'lucide-react';
import { isDemo } from '../../config';
import {
  getVault,
  getDelegate,
  getManagedSession,
  managedSessionPay,
  getGlobals,
  getPinnedCommitments,
  type ManagedSession,
} from '../../lib/vault';
import { getServices } from '../../lib/services';
import { getPolicies, type Policy } from '../../lib/policies';
import { getTasks, createTask, planInstruction, type HireMode } from '../../lib/tasks';
import { getActivity } from '../../lib/activity';
import { proveAndReleaseBatch } from '../../lib/prove';
import { Card, CardHeader, EmptyState, PageHeader, controls } from '../../components/ui';
import {
  describeSavedLimit,
  resolvePinnedBundle,
  resolveGlobalPrivateBundle,
} from './limits-model';

const inputCls = controls.field;
const primaryBtn = controls.primary;
const chipBtn = controls.chip;

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
type Bind = { policyId?: string };
type Line = { payee: string; amount: string; reason: string };
type PlanLine = { payee: string; amount: number; reason?: string };
type Plan = {
  kind: 'pay' | 'disburse' | 'hire';
  lane: 'private' | 'public';
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

const AGENT_INTRO =
  "I'm your spending agent. Tell me what to do with your budget, or use a quick action. I'll propose a plan and you approve before anything moves. The vault enforces the rule you pick, so I can never overspend or pay outside it.";

// The agent conversation is persisted here so it survives navigating away and back,
// and a full reload. Scoped per browser.
const CHAT_KEY = 'cc:agent:chat';

/**
 * The lane toggle + rule selector shared by the NL composer and the quick-action
 * composer. Private (default) is a ZK-proven, keyless spend under a pinned rule you
 * created; public is the single Managed Session's on-chain scope. Only user-created
 * rules are selectable, filtered by lane.
 */
function RuleLanePicker({
  lane,
  setLane,
  ruleId,
  setRuleId,
  privateRules,
  boundRuleLabel,
  sessionActive,
  managed,
  applied,
  usingGlobalAsRule,
  publicGlobalActive,
}: {
  lane: 'private' | 'public';
  setLane: (l: 'private' | 'public') => void;
  ruleId: string;
  setRuleId: (id: string) => void;
  privateRules: Policy[];
  /** The public rule the Managed Session is BOUND to (picked on the Vault tab), or null. */
  boundRuleLabel: string | null;
  sessionActive: boolean;
  managed: ManagedSession | undefined;
  applied: Applied;
  usingGlobalAsRule: boolean;
  /** A public rule is marked global, so the vault AND-enforces it on every session spend. */
  publicGlobalActive: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <SlidersHorizontal size={13} className="text-violet-300" /> Enforced rule
        </span>
        <div className="inline-flex rounded-lg bg-black/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setLane('private')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${lane === 'private' ? 'bg-violet-500/25 text-violet-200' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Lock size={11} /> Private
          </button>
          <button
            type="button"
            onClick={() => setLane('public')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${lane === 'public' ? 'bg-sky-500/25 text-sky-200' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Eye size={11} /> Public
          </button>
        </div>
        {lane === 'private' ? (
          privateRules.length ? (
            <select
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              className="cc-input max-w-[17rem] flex-1 !py-1.5 text-sm"
              aria-label="Private rule the vault enforces"
            >
              <option value="">
                {usingGlobalAsRule ? 'None (global rule applies)' : 'None selected'}
              </option>
              {privateRules.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || describeSavedLimit(p)}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-amber-300/80">
              No pinned private rule. Create one and pin it on the Rules tab.
            </span>
          )
        ) : !sessionActive ? (
          <span className="text-xs text-amber-300/80">
            No Managed Session. Set one up on the Vault tab.
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            {`Managed Session · ${managed!.session!.remainingUsdc.toFixed(2)} USDC cap left · rule: ${
              boundRuleLabel ?? 'bound on-chain'
            }${publicGlobalActive ? ' · global applies' : ''}`}
          </span>
        )}
        <Link to="/app/rules" className="text-xs text-violet-300 hover:text-violet-200">
          Manage rules
        </Link>
      </div>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-violet-300" />
        <span>
          The vault enforces <span className="text-slate-300">{applied.label}</span>
          {lane === 'private'
            ? usingGlobalAsRule
              ? ': your global rule governs every private spend on its own, keyless and on-chain.'
              : ', keyless and on-chain: your rule stays private and only you can prove a spend.'
            : ', on-chain via your Managed Session, hands-off within its scope.'}
        </span>
      </p>
    </div>
  );
}

export function CommandChat() {
  const qc = useQueryClient();
  // The conversation persists across navigation and reloads (it was resetting on
  // every remount). Stored per browser; cleared explicitly via "Clear".
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      const parsed = raw ? (JSON.parse(raw) as Msg[]) : null;
      if (parsed && parsed.length) return parsed;
    } catch {
      // ignore a corrupt cache
    }
    return [{ id: 1, role: 'agent', text: AGENT_INTRO }];
  });
  // Next id continues past the highest restored id so ids never collide.
  const idRef = useRef(messages.reduce((m, x) => Math.max(m, x.id), 1) + 1);
  const nextId = () => idRef.current++;
  // Keep the conversation scrolled to the newest message (it sits above the composer).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // Persist on every change so leaving and returning keeps the history intact.
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-200)));
    } catch {
      // ignore quota / serialization issues
    }
  }, [messages]);
  function clearChat() {
    idRef.current = 2;
    setMessages([{ id: 1, role: 'agent', text: AGENT_INTRO }]);
    try {
      localStorage.removeItem(CHAT_KEY);
    } catch {
      // ignore
    }
  }

  const [action, setAction] = useState<'pay' | 'disburse' | 'hire' | null>(null);
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([{ payee: '', amount: '', reason: '' }]);
  const [serviceId, setServiceId] = useState('');
  const [budget, setBudget] = useState('');

  // Which lane the vault enforces this spend in: private (a ZK proof hides the rule,
  // keyless, the safe default) or public (the Managed Session's on-chain scope,
  // hands-off). Sticky across instructions.
  const [lane, setLane] = useState<'private' | 'public'>('private');
  // The selected PRIVATE rule (a user-created, pinned policy). No 'default'/'none'/
  // 'custom': only a rule you created ever governs a spend.
  const [ruleId, setRuleId] = useState<string>('');

  // Natural-language box: the agent parses it into a plan you then approve.
  const [nl, setNl] = useState('');

  const { data: servicePage } = useQuery({
    queryKey: ['services', { picker: true }],
    queryFn: () => getServices({ limit: 100 }),
  });
  const services = servicePage?.items ?? [];
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: vaultData } = useQuery({ queryKey: ['vault'], queryFn: getVault });
  const { data: pinnedList = [] } = useQuery({
    queryKey: ['pinned-commitments'],
    queryFn: getPinnedCommitments,
  });
  const pinnedSet = new Set(pinnedList.map((c) => c.toLowerCase()));
  const { data: managed } = useQuery({
    queryKey: ['managed-session'],
    queryFn: getManagedSession,
  });
  const { data: globals } = useQuery({ queryKey: ['globals'], queryFn: getGlobals });

  // Only PINNED private rules are selectable: an unpinned commitment cannot authorize
  // a spend on-chain (the vault rejects it, CommitmentNotAuthorized). Public spending
  // is the Managed Session, not a per-instruction rule.
  const privateRules = policies.filter(
    (p) =>
      (p.form === 'private' || (!p.form && p.isPrivate)) &&
      pinnedSet.has(p.commitment.toLowerCase()),
  );
  // The global-private rule, if set AND it is a pinned private rule (only a pinned
  // commitment can authorize). It applies to EVERY private spend.
  const globalPolicy = globals?.privateCommitment
    ? privateRules.find(
        (p) => p.commitment.toLowerCase() === globals.privateCommitment!.toLowerCase(),
      )
    : undefined;
  // No auto-default: the picker starts at "none selected" and a private spend cannot
  // run until you pick a rule - UNLESS a global is active, which then governs on its
  // own (the one case a spend runs with nothing picked).
  const pickedRule = privateRules.find((p) => p.id === ruleId);
  const enforcedRule = pickedRule ?? globalPolicy;
  const usingGlobalAsRule = !pickedRule && !!globalPolicy;
  const sessionActive = !!managed?.session && managed.session.expiry * 1000 > Date.now();
  // The Managed Session is BOUND to a public rule at enable time (on the Vault tab), so
  // public spending needs no per-task rule pick - the bound rule governs. Resolve its
  // label for display.
  const boundRule = managed?.session?.ruleId
    ? policies.find((p) => p.commitment.toLowerCase() === managed.session!.ruleId!.toLowerCase())
    : undefined;
  const boundRuleLabel = boundRule
    ? boundRule.name || describeSavedLimit(boundRule)
    : managed?.session?.ruleId
      ? 'bound on-chain'
      : null;

  // What the vault will enforce for the next instruction, as a short label.
  const applied: Applied = (() => {
    if (lane === 'public') {
      return {
        label: sessionActive
          ? `Managed Session · ${managed!.session!.remainingUsdc.toFixed(2)} USDC cap left`
          : 'no Managed Session yet',
        isPrivate: false,
      };
    }
    if (usingGlobalAsRule) return { label: 'your global rule', isPrivate: true };
    if (enforcedRule) return { label: describeSavedLimit(enforcedRule), isPrivate: true };
    return { label: 'none selected', isPrivate: true };
  })();
  // Whether the current lane is ready to spend. Public needs only a live Managed Session
  // (its bound rule governs). Private needs a selected rule (or an active global).
  const laneReady = lane === 'public' ? sessionActive : !!enforcedRule;

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

  const planMut = useMutation({
    mutationFn: (instruction: string) => planInstruction(instruction),
  });

  // A clear reason the current lane can't act, or null when it's ready. Nothing (not
  // even the AI planner) runs until a valid, enforceable rule is in place.
  function laneBlockedReason(): string | null {
    if (lane === 'public') {
      return sessionActive
        ? null
        : 'No active Managed Session. Set one up on the Vault tab (cap + expiry + a rule) before spending in public mode.';
    }
    return enforcedRule
      ? null
      : 'No rule selected. Pick a pinned private rule above (or set a global rule on the Rules tab, which then applies on its own).';
  }

  // Send the typed instruction to the agent; it returns a plan you then approve.
  async function askAgent() {
    const instruction = nl.trim();
    if (!instruction) return;
    // Do NOT call the AI (or anything) without an enforceable rule in place.
    const blocked = laneBlockedReason();
    if (blocked) {
      push({ id: nextId(), role: 'agent', ok: false, text: blocked });
      return;
    }
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
    // The enforced rule is ALWAYS the one the user selected (or budget-only). The
    // agent never reads, infers, or chooses a rule - private rules are not even
    // visible to it - so we bind the user's pick as-is.
    const bind = currentBind();
    const appliedLimit = applied;
    if (result.kind === 'hire' && result.service) {
      push({
        id: nextId(),
        role: 'plan',
        status: 'pending',
        plan: {
          kind: 'hire',
          lane,
          summary: `Hire ${result.service.name} (budget $${result.budget.toFixed(2)})`,
          lines: [{ payee: result.service.name, amount: result.budget, reason: 'service' }],
          limit: appliedLimit,
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
          lane,
          summary:
            result.kind === 'pay'
              ? `Pay ${short(lines[0].payee)} $${lines[0].amount.toFixed(2)}`
              : `Disburse $${total.toFixed(2)} to ${lines.length} recipient${lines.length > 1 ? 's' : ''}`,
          lines,
          limit: appliedLimit,
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
    // Private binds the selected pinned rule; public spends under the Managed Session.
    return lane === 'private' ? { policyId: enforcedRule?.id } : {};
  }

  function propose() {
    if (!action) return;
    const blocked = laneBlockedReason();
    if (blocked) {
      push({ id: nextId(), role: 'agent', ok: false, text: blocked });
      return;
    }
    const bind = currentBind();
    let plan: Plan | null = null;
    let userText = '';
    if (action === 'pay') {
      const amt = Number(amount);
      if (!payee.trim() || !(amt > 0)) return;
      plan = {
        kind: 'pay',
        lane,
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
        lane,
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
        lane,
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

  async function approve(id: number, plan: Plan) {
    setPlanStatus(id, 'approved');
    if (plan.kind === 'hire' && plan.serviceId) {
      try {
        const policyId = plan.bind.policyId;
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
    // pay / disburse: a real, rule-bounded release from the vault.
    if (plan.kind !== 'pay' && plan.kind !== 'disburse') return;

    // The only precondition the chain would fail on AFTER proving is the balance.
    const planTotal = plan.lines.reduce((s, l) => s + l.amount, 0);
    if (planTotal > (vaultData?.available ?? 0)) {
      push({
        id: nextId(),
        role: 'agent',
        ok: false,
        text: `Not enough in your vault: this needs ${planTotal.toFixed(2)} USDC but ${(vaultData?.available ?? 0).toFixed(2)} is available. Fund your vault (Vault tab), then approve again.`,
      });
      return;
    }

    // PUBLIC lane: spend hands-off under the Managed Session (the server signs within
    // its on-chain scope; no proof, no wallet prompt, instant).
    if (plan.lane === 'public') {
      try {
        push({ id: nextId(), role: 'agent', text: 'Spending under your Managed Session…' });
        for (const l of plan.lines) {
          await managedSessionPay(l.payee, l.amount);
        }
        qc.invalidateQueries({ queryKey: ['tasks'] });
        qc.invalidateQueries({ queryKey: ['vault'] });
        qc.invalidateQueries({ queryKey: ['managed-session'] });
        push({
          id: nextId(),
          role: 'agent',
          ok: true,
          text: `Sent $${planTotal.toFixed(2)} across ${plan.lines.length} payment${plan.lines.length > 1 ? 's' : ''} under your Managed Session. Watch it settle in Activity.`,
        });
      } catch (e) {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: e instanceof Error ? e.message : 'Could not send under the Managed Session.',
        });
      }
      return;
    }

    // PRIVATE lane: KEYLESS, client-proven release under your pinned rule. The rule
    // never leaves this device; the proof + the pinned commitment + a fresh nullifier
    // authorize it on-chain, a fee-payer relayer only submits. One wallet signature,
    // up front, pinned the rule; nothing signs per payment.
    try {
      const p = plan.bind.policyId ? policies.find((x) => x.id === plan.bind.policyId) : undefined;
      if (!p) {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: 'No private rule selected. Pick one above (or create one on the Rules tab).',
        });
        return;
      }
      const pinned = await resolvePinnedBundle(p);
      if (!pinned) {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: 'That rule was created on another device and has no backup, so it cannot be proven here. Re-create it on this device, or pick another.',
        });
        return;
      }
      // If a global-private rule is set, the vault requires a SECOND proof against it.
      const globals = await getGlobals();
      let globalBundle: Awaited<ReturnType<typeof resolveGlobalPrivateBundle>> = null;
      if (globals.privateCommitment) {
        globalBundle = await resolveGlobalPrivateBundle(policies, globals.privateCommitment);
        if (!globalBundle) {
          push({
            id: nextId(),
            role: 'agent',
            ok: false,
            text: 'Your global rule was created on another device and cannot be proven here. Re-create it on this device, or clear the global on the Rules tab.',
          });
          return;
        }
      }
      push({
        id: nextId(),
        role: 'agent',
        text: 'Proving your plan in the browser with zero-knowledge (a few seconds)…',
      });
      const result = await proveAndReleaseBatch({
        bundle: pinned,
        globalBundle,
        recipients: plan.lines.map((l) => ({ payee: l.payee, amount: l.amount })),
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['vault'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      push({
        id: nextId(),
        role: 'agent',
        ok: true,
        text: `Proved and sent $${result.total.toFixed(2)} across ${result.legs} payment${result.legs > 1 ? 's' : ''} in ${result.batches} on-chain proof${result.batches > 1 ? 's' : ''}, with your rule kept private. The chain verified each proof before releasing; watch it settle in Activity.`,
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
        hint="It proposes a plan; you approve; the vault enforces the rule you pick"
      />
      <div className="flex flex-col p-5">
        {/* Conversation sits ABOVE the composer and auto-scrolls to the newest
            message, so a reply lands right over the input and you can keep typing
            without scrolling. */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
              Conversation
            </span>
            {messages.length > 1 && (
              <button
                onClick={clearChat}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          <div
            ref={scrollRef}
            className="max-h-[22rem] min-h-[8rem] space-y-3 overflow-y-auto pr-1"
          >
            {messages.map((m) => (
              <ChatBubble
                key={m.id}
                msg={m}
                onApprove={approve}
                onCancel={(id) => setPlanStatus(id, 'cancelled')}
              />
            ))}
          </div>
        </div>

        {/* Composer, pinned below the conversation. */}
        <div className="border-t border-line pt-4">
          {/* Natural language: the agent parses it into a plan. The instruction
              bar is the focal hero of this page, so give it an accented panel. */}
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-violet-200/90">
              Instruct your agent
            </label>
            <textarea
              value={nl}
              onChange={(e) => setNl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  askAgent();
                }
              }}
              rows={3}
              placeholder="e.g. Pay GC3F… 420 USDC for design and MEI… 275 for docs — max 500 each. Or: split 900 USDC evenly between these three addresses."
              className="cc-input mt-1.5 min-h-[5.5rem] w-full resize-none text-base leading-relaxed"
            />

            <div className="mt-3 space-y-2.5">
              <RuleLanePicker
                lane={lane}
                setLane={setLane}
                ruleId={ruleId}
                setRuleId={setRuleId}
                privateRules={privateRules}
                boundRuleLabel={boundRuleLabel}
                sessionActive={sessionActive}
                managed={managed}
                applied={applied}
                usingGlobalAsRule={usingGlobalAsRule}
                publicGlobalActive={!!globals?.publicRuleId}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Your words decide <span className="text-slate-300">what</span> to do; the vault
                  enforces the rule you pick, on-chain, so the agent can&apos;t overspend or pay
                  outside it. You approve a checked plan first.
                </p>
                <button
                  onClick={askAgent}
                  disabled={!nl.trim() || planMut.isPending || !laneReady}
                  className={primaryBtn}
                >
                  {planMut.isPending ? 'Thinking…' : 'Plan it'}
                </button>
              </div>
            </div>
          </div>

          <div className="mb-2 mt-4 text-[11px] uppercase tracking-wider text-slate-600">
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

              {/* The rule the vault enforces for this instruction */}
              <div className="mt-3 border-t border-line pt-3">
                <RuleLanePicker
                  lane={lane}
                  setLane={setLane}
                  ruleId={ruleId}
                  setRuleId={setRuleId}
                  privateRules={privateRules}
                  boundRuleLabel={boundRuleLabel}
                  sessionActive={sessionActive}
                  managed={managed}
                  applied={applied}
                  usingGlobalAsRule={usingGlobalAsRule}
                  publicGlobalActive={!!globals?.publicRuleId}
                />
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={propose} disabled={!laneReady} className={primaryBtn}>
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
            {plan.limit.isPrivate ? <EyeOff size={11} /> : <Eye size={11} />} rule:{' '}
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
  // The unified feed (job lifecycle + deposits/withdrawals + keyless private
  // payments), so a private spend you just made shows here with its on-chain receipt,
  // not only task events.
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: getActivity,
  });
  const shown = items.slice(0, 6);
  return (
    <Card className="p-0">
      <CardHeader
        icon={ListChecks}
        title="Recent activity"
        action={
          items.length > 6 ? (
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
          {shown.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="text-xs text-slate-500">
                  {item.detail ? `${item.detail} · ` : ''}
                  {item.status ?? item.kind.replace(/_/g, ' ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {item.amount != null && (
                  <span className="cc-num font-mono text-sm font-semibold text-slate-100">
                    ${item.amount.toFixed(2)}
                  </span>
                )}
                {item.txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-500 hover:text-violet-300"
                    title="View the on-chain receipt"
                  >
                    receipt
                  </a>
                )}
              </div>
            </div>
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
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('cc:home:guide') === 'off',
  );

  // In demo mode the vault is pre-funded with sample activity, so the guide is
  // irrelevant; and once a real user has done anything, the on-ramp is over.
  if (isDemo() || dismissed || tasks.length > 0) return null;

  const funded = (vault?.balance ?? 0) > 0;
  // The settlement relayer is an onboarding step: registering it lets the server
  // submit your proofs so a release settles without a wallet prompt each time.
  const relayerOffered = delegate?.settlementEnabled ?? false;
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
      label: 'Create a spending rule',
      desc: 'A private cap + allowlist the vault enforces. You pick which rule governs each spend.',
      cta: 'Add a rule',
      to: '/app/rules',
    },
    ...(relayerOffered
      ? [
          {
            done: !!delegate?.registered,
            label: 'Register the settlement relayer',
            desc: 'Register your bounded relayer once so releases settle without a wallet prompt each time. It only submits your proof — it holds no funds, cannot forge a proof, and never picks your rule.',
            cta: 'Register',
            to: '/app/vault',
          },
        ]
      : []),
    {
      done: false,
      label: 'Tell your agent what to do',
      desc: 'Type an instruction above (or pick a quick action). You approve the plan; the vault enforces the rule you picked.',
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
    <div className="cc-stagger space-y-6">
      <PageHeader
        eyebrow="Agent"
        title="Tell your agent what to do"
        subtitle="Put an AI agent in charge of your money, within private limits it can't break. Instruct it in plain language; approve a checked plan; the vault enforces the rule."
      />
      {/* Command-first: the agent prompt + quick actions are the subject of the
          page; the budget is a compact strip above it, funding lives on Vault. */}
      <VaultStrip />
      <CommandChat />
      <FirstRunGuide />
      <RecentActivity />
    </div>
  );
}
