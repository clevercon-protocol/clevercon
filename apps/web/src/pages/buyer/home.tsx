import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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
  Paperclip,
  Loader2,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { isDemo, config } from '../../config';
import { useSession } from '../../store/session';
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
import {
  getTasks,
  getTask,
  answerStep,
  createTask,
  planInstruction,
  type HireMode,
  type TaskStepView,
  type TaskDetail,
} from '../../lib/tasks';
import { uploadFile, validateAttachment, type ArtifactRef } from '../../lib/uploads';
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
// How that limit binds to the task: a pinned private rule (policyId) for the private
// lane, or a chosen public rule's on-chain id (publicRuleId) for the public lane;
// either may be absent (a global rule, or the session's bound rule, governs then).
type Bind = { policyId?: string; publicRuleId?: string };
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
  // For a multi-function service: the function the agent chose (the dispatched action).
  functionKey?: string;
  // Buyer-supplied input files for a hire (uploaded to R2 as content-addressed
  // refs at propose time, so they survive chat persistence and reach the provider).
  attachments?: ArtifactRef[];
  // Structured params the planner extracted for the chosen service (e.g. width/format).
  input?: Record<string, unknown>;
};
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'plan'; plan: Plan; status: 'pending' | 'approved' | 'cancelled' }
  | { id: number; role: 'agent'; text: string; ok?: boolean }
  // A live job: polls the task and shows status, progress, needs-input, and output.
  // Carries the rule lane + id the chat already knows, so the card settles the hire
  // under the SAME rule the buyer picked (authoritative; never a wrong-lane guess).
  | {
      id: number;
      role: 'job';
      taskId: string;
      title: string;
      policyId?: string;
      publicRuleId?: string;
      lane?: 'private' | 'public';
    };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const AGENT_INTRO =
  "I'm your spending agent. Tell me what to do with your budget, or use a quick action. I'll propose a plan and you approve before anything moves. The vault enforces the rule you pick, so I can never overspend or pay outside it.";

// The agent conversation is persisted so it survives navigating away and back, and a
// full reload. Scoped by the connected account so a different wallet on the same
// device never sees another account's conversation.
const chatKeyFor = (account: string) => `cc:agent:chat:${account}`;
function loadChat(account: string): Msg[] | null {
  if (!account) return null;
  try {
    const raw = localStorage.getItem(chatKeyFor(account));
    const parsed = raw ? (JSON.parse(raw) as Msg[]) : null;
    return parsed && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

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
  publicRules,
  publicRuleId,
  setPublicRuleId,
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
  /** The user's public rules, selectable per instruction in the public lane. */
  publicRules: Policy[];
  /** The chosen public rule's on-chain id (its commitment/rid); '' = session's bound rule. */
  publicRuleId: string;
  setPublicRuleId: (id: string) => void;
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
        ) : publicRules.length > 0 ? (
          <>
            <select
              value={publicRuleId}
              onChange={(e) => setPublicRuleId(e.target.value)}
              className="cc-input max-w-[17rem] flex-1 !py-1.5 text-sm"
              aria-label="Public rule the vault enforces"
            >
              <option value="">
                {boundRuleLabel ? `Session's bound rule (${boundRuleLabel})` : 'Session cap only'}
              </option>
              {publicRules.map((p) => (
                <option key={p.id} value={p.commitment}>
                  {p.name || describeSavedLimit(p)}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              {`${managed!.session!.remainingUsdc.toFixed(2)} USDC cap left${publicGlobalActive ? ' · global applies' : ''}`}
            </span>
          </>
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

/**
 * Search-driven allow-list of services for the agent (scales to a large directory:
 * it never lists everything, searches on demand, and keeps only the selected set).
 */
function AllowedServicesPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string }[];
  onChange: (v: { id: string; name: string }[]) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ['svc-search', debounced],
    queryFn: () => getServices({ q: debounced, limit: 8 }),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const results = (data?.items ?? []).filter((r) => !value.some((v) => v.id === r.id)).slice(0, 8);
  const label =
    value.length === 0
      ? '· the agent may use any'
      : value.length === 1
        ? '· the agent will use this one'
        : `· the agent picks the best of ${value.length}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <SlidersHorizontal size={12} className="shrink-0 text-violet-300" />
        <span>Allowed services (optional)</span>
        <span className="text-slate-600">{label}</span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-auto text-slate-500 hover:text-slate-300"
          >
            clear
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-500/50 bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200"
            >
              {s.name}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v.id !== s.id))}
                className="text-violet-300/70 hover:text-white"
                aria-label={`Remove ${s.name}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative mt-1.5">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search services to allow…"
          className="w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
        />
        {open && results.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-white/10 bg-surface-2 shadow-lg">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange([...value, { id: r.id, name: r.name }]);
                  setQ('');
                }}
                className="block w-full px-2.5 py-1.5 text-left text-xs text-slate-300 hover:bg-white/[0.05]"
              >
                {r.name} <span className="text-slate-500">· ${r.pricePerCall}/call</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommandChat() {
  const qc = useQueryClient();
  const address = useSession((s) => s.session?.address ?? '');
  // The conversation persists across navigation and reloads, per connected account.
  const [messages, setMessages] = useState<Msg[]>(
    () => loadChat(address) ?? [{ id: 1, role: 'agent', text: AGENT_INTRO }],
  );
  // Next id continues past the highest restored id so ids never collide.
  const idRef = useRef(messages.reduce((m, x) => Math.max(m, x.id), 1) + 1);
  const nextId = () => idRef.current++;
  // Keep the conversation scrolled to the newest message (it sits above the composer).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // Reload the conversation when the connected account changes, so one account's chat
  // never carries into another on the same device.
  useEffect(() => {
    setMessages(loadChat(address) ?? [{ id: 1, role: 'agent', text: AGENT_INTRO }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  // Persist on every change so leaving and returning keeps the history intact.
  useEffect(() => {
    if (!address) return;
    try {
      localStorage.setItem(chatKeyFor(address), JSON.stringify(messages.slice(-200)));
    } catch {
      // ignore quota / serialization issues
    }
  }, [messages, address]);
  function clearChat() {
    idRef.current = 2;
    setMessages([{ id: 1, role: 'agent', text: AGENT_INTRO }]);
    try {
      localStorage.removeItem(chatKeyFor(address));
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
  // Input file for a hire, shown ONLY when the chosen service declares it takes
  // files (attachmentsIn); fileErr holds a client-side validation message.
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  // Which lane the vault enforces this spend in: private (a ZK proof hides the rule,
  // keyless, the safe default) or public (the Managed Session's on-chain scope,
  // hands-off). Sticky across instructions.
  const [lane, setLane] = useState<'private' | 'public'>('private');
  // The selected PRIVATE rule (a user-created, pinned policy). No 'default'/'none'/
  // 'custom': only a rule you created ever governs a spend.
  const [ruleId, setRuleId] = useState<string>('');
  // The selected PUBLIC rule for the public lane, by its on-chain id (the rule's
  // commitment/rid). '' = fall back to the rule bound to the Managed Session. The
  // vault enforces the picked public rule on this spend (release_payment_session).
  const [publicRuleId, setPublicRuleId] = useState<string>('');

  // Natural-language box: the agent parses it into a plan you then approve.
  const [nl, setNl] = useState('');
  // Optional allow-list: the services the agent MAY use for this prompt. Empty = any.
  // One = forced; several = the agent picks the best of them. Searched on demand so
  // it scales to a large directory (never lists everything). Stores {id,name} so the
  // selected chips render without re-fetching.
  const [allowedServices, setAllowedServices] = useState<{ id: string; name: string }[]>([]);

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
  // a spend on-chain (the vault rejects it, CommitmentNotAuthorized).
  const privateRules = policies.filter(
    (p) =>
      (p.form === 'private' || (!p.form && p.isPrivate)) &&
      p.status !== 'archived' &&
      pinnedSet.has(p.commitment.toLowerCase()),
  );
  // The user's public rules, selectable per instruction in the public lane. The vault
  // enforces the picked one on this session spend (its rid is the on-chain id); an
  // un-pinned pick returns a clean "pin it first" error at spend time.
  const publicRules = policies.filter(
    (p) => (p.form === 'public' || (!p.form && !p.isPrivate)) && p.status !== 'archived',
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
    mutationFn: (p: {
      title: string;
      serviceId: string;
      functionKey?: string;
      budget: number;
      policyId?: string;
      input?: Record<string, unknown>;
    }) =>
      createTask({
        title: p.title,
        mode: 'DIRECT' as HireMode,
        budget: p.budget,
        serviceId: p.serviceId,
        functionKey: p.functionKey,
        policyId: p.policyId,
        input: p.input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  // Upload the attached file (if any) to a content-addressed ref; returns the
  // attachments array for a job input, or undefined. Throws on upload failure.
  async function takeAttachments(): Promise<ArtifactRef[] | undefined> {
    if (!file) return undefined;
    const ref = await uploadFile(file);
    return [ref];
  }

  const planMut = useMutation({
    mutationFn: (vars: { instruction: string; hasAttachment: boolean; serviceIds?: string[] }) =>
      planInstruction(vars.instruction, vars.hasAttachment, vars.serviceIds),
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
      result = await planMut.mutateAsync({
        instruction,
        hasAttachment: !!file,
        serviceIds: allowedServices.length ? allowedServices.map((s) => s.id) : undefined,
      });
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
      // Reconcile any attached file with what the PLANNED service declares it takes,
      // so a file only goes to a service that accepts it and the UI is honest.
      const svc = services.find((s) => s.id === result.service!.id);
      const spec = svc?.attachmentsIn ?? null;
      const err = (text: string) => {
        push({ id: nextId(), role: 'agent', ok: false, text });
      };
      if (file && !spec) {
        err(
          `I planned ${result.service.name}, but it doesn’t accept files, so I can’t attach your document. Remove the file, or ask for a service that processes documents.`,
        );
        return;
      }
      if (!file && spec?.required) {
        err(`${result.service.name} needs a file to run. Attach one to your message, then plan again.`);
        return;
      }
      if (file && spec) {
        const v = validateAttachment(file, spec);
        if (v) {
          err(`${result.service.name}: ${v}`);
          return;
        }
      }
      let attachments: ArtifactRef[] | undefined;
      try {
        attachments = await takeAttachments();
      } catch {
        err('Could not upload the attachment. Please try again.');
        return;
      }
      setFile(null);
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
          ...(result.functionKey ? { functionKey: result.functionKey } : {}),
          ...(attachments ? { attachments } : {}),
          ...(result.input ? { input: result.input } : {}),
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
    setFile(null);
    setFileErr(null);
  }

  function push(...msgs: Msg[]) {
    setMessages((m) => [...m, ...msgs]);
  }

  function currentBind(): Bind {
    // Private binds the selected pinned rule; public binds the chosen public rule's
    // on-chain id (or none, to use the session's bound rule).
    return lane === 'private'
      ? { policyId: enforcedRule?.id }
      : { publicRuleId: publicRuleId || undefined };
  }

  async function propose() {
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
      // A service that declares a required input file cannot run without one.
      if (svc.attachmentsIn?.required && !file) {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: `${svc.name} needs a file attached to run. Add one below, then propose again.`,
        });
        return;
      }
      let attachments: ArtifactRef[] | undefined;
      try {
        attachments = await takeAttachments();
      } catch {
        push({ id: nextId(), role: 'agent', ok: false, text: 'Could not upload the attachment. Please try again.' });
        return;
      }
      plan = {
        kind: 'hire',
        lane,
        summary: `Hire ${svc.name} (budget $${bud.toFixed(2)})`,
        lines: [{ payee: svc.name, amount: bud, reason: 'service' }],
        limit: applied,
        bind,
        serviceName: svc.name,
        serviceId: svc.id,
        ...(attachments ? { attachments } : {}),
      };
      userText = `Hire ${svc.name} with a $${bud.toFixed(2)} budget${attachments ? ' (with an attachment)' : ''}.`;
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

  // Swap the service on a pending hire plan (the dropdown on the plan card), so the
  // user can override the agent's pick before approving.
  function pickService(msgId: number, serviceId: string) {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return;
    setMessages((m) =>
      m.map((x) => {
        if (x.role !== 'plan' || x.id !== msgId || x.plan.kind !== 'hire') return x;
        const budget = x.plan.lines[0]?.amount ?? 0;
        return {
          ...x,
          plan: {
            ...x.plan,
            serviceId: svc.id,
            serviceName: svc.name,
            summary: `Hire ${svc.name} (budget $${budget.toFixed(2)})`,
            lines: [{ ...x.plan.lines[0], payee: svc.name }],
          },
        };
      }),
    );
  }

  async function approve(id: number, plan: Plan) {
    setPlanStatus(id, 'approved');
    if (plan.kind === 'hire' && plan.serviceId) {
      try {
        const policyId = plan.bind.policyId;
        const jobInput: Record<string, unknown> = { ...(plan.input ?? {}) };
        if (plan.attachments?.length) jobInput.attachments = plan.attachments;
        const task = await hire.mutateAsync({
          title: `Hire ${plan.serviceName}`,
          serviceId: plan.serviceId,
          functionKey: plan.functionKey,
          budget: plan.lines[0].amount,
          policyId,
          input: Object.keys(jobInput).length ? jobInput : undefined,
        });
        // Drop a LIVE job card into the chat: it polls the task and shows progress,
        // any question it needs answered, and the result/download inline.
        push({
          id: nextId(),
          role: 'job',
          taskId: task.id,
          title: plan.serviceName ?? 'Service',
          // Settle under the exact rule the buyer picked for this hire.
          policyId: plan.bind.policyId,
          publicRuleId: plan.bind.publicRuleId,
          lane: plan.lane,
        });
      } catch (e) {
        push({
          id: nextId(),
          role: 'agent',
          ok: false,
          text: e instanceof Error ? e.message : 'Could not create the job. Please try again.',
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

    // Settle under the selected rule - the SAME path a job uses to pay a provider
    // (see settleUnderRule): private proves your pinned rule and releases keyless,
    // public spends under the Managed Session. Only the surrounding chat messages
    // differ here.
    try {
      push({
        id: nextId(),
        role: 'agent',
        text:
          plan.lane === 'public'
            ? 'Spending under your Managed Session…'
            : 'Proving your plan in the browser with zero-knowledge (a few seconds)…',
      });
      const result = await settleUnderRule({
        lane: plan.lane,
        policyId: plan.bind.policyId,
        publicRuleId: plan.bind.publicRuleId,
        recipients: plan.lines.map((l) => ({ payee: l.payee, amount: l.amount })),
        policies,
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['vault'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      if (plan.lane === 'public') qc.invalidateQueries({ queryKey: ['managed-session'] });
      push({
        id: nextId(),
        role: 'agent',
        ok: true,
        text:
          plan.lane === 'public'
            ? `Sent $${result.total.toFixed(2)} across ${result.legs} payment${result.legs > 1 ? 's' : ''} under your Managed Session. Watch it settle in Activity.`
            : `Proved and sent $${result.total.toFixed(2)} across ${result.legs} payment${result.legs > 1 ? 's' : ''}, with your rule kept private. The chain verified each proof before releasing; watch it settle in Activity.`,
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
                services={services}
                onPickService={pickService}
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

            {/* Attach a document/image to the instruction. The agent attaches it only
                when the service it plans actually accepts files; otherwise it says so. */}
            {file ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
                <Paperclip size={12} className="shrink-0 text-violet-300" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setFileErr(null);
                  }}
                  className="shrink-0 text-slate-500 hover:text-white"
                  aria-label="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200">
                <Paperclip size={12} /> Attach a file
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setFileErr(null);
                  }}
                />
              </label>
            )}
            {fileErr && <p className="mt-1 text-[11px] text-red-400">{fileErr}</p>}

            <div className="mt-3 space-y-2.5">
              <RuleLanePicker
                lane={lane}
                setLane={setLane}
                ruleId={ruleId}
                setRuleId={setRuleId}
                privateRules={privateRules}
                publicRules={publicRules}
                publicRuleId={publicRuleId}
                setPublicRuleId={setPublicRuleId}
                boundRuleLabel={boundRuleLabel}
                sessionActive={sessionActive}
                managed={managed}
                applied={applied}
                usingGlobalAsRule={usingGlobalAsRule}
                publicGlobalActive={!!globals?.publicRuleId}
              />
              <AllowedServicesPicker value={allowedServices} onChange={setAllowedServices} />
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
                  {(() => {
                    const svc = services.find((s) => s.id === serviceId);
                    // Only services that DECLARE they take input files show an attacher;
                    // attaching a file to a service that ignores it would be misleading.
                    const spec = svc?.attachmentsIn;
                    if (!spec) return null;
                    const required = !!spec.required;
                    const accept = spec.accept?.length ? spec.accept.join(',') : undefined;
                    return (
                      <div className="sm:col-span-2">
                        {file ? (
                          <div className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
                            <Paperclip size={12} className="shrink-0 text-violet-300" />
                            <span className="min-w-0 flex-1 truncate">{file.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setFile(null);
                                setFileErr(null);
                              }}
                              className="shrink-0 text-slate-500 hover:text-white"
                              aria-label="Remove attachment"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <label
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs hover:border-violet-500/40 hover:text-slate-300 ${
                              required ? 'border-amber-500/40 text-amber-300' : 'border-white/10 text-slate-400'
                            }`}
                          >
                            <Paperclip size={12} />
                            {required
                              ? `Attach a file (required${accept ? ` · ${accept}` : ''})`
                              : `Attach a file (optional${accept ? ` · ${accept}` : ''})`}
                            <input
                              type="file"
                              className="hidden"
                              {...(accept ? { accept } : {})}
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                const err = f ? validateAttachment(f, spec) : null;
                                if (err) {
                                  setFileErr(err);
                                  setFile(null);
                                } else {
                                  setFileErr(null);
                                  setFile(f);
                                }
                              }}
                            />
                          </label>
                        )}
                        {fileErr && <p className="mt-1 text-[11px] text-red-400">{fileErr}</p>}
                      </div>
                    );
                  })()}
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
                  publicRules={publicRules}
                  publicRuleId={publicRuleId}
                  setPublicRuleId={setPublicRuleId}
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

const resolveArtifact = (url: string) => (/^https?:\/\//.test(url) ? url : `${config.apiUrl}${url}`);

/** A compact answer box for a step the service parked as needs-input (in chat). */
function InlineAnswer({ taskId, step }: { taskId: string; step: TaskStepView }) {
  const qc = useQueryClient();
  const [val, setVal] = useState('');
  const send = useMutation({
    mutationFn: () => {
      const schema = step.inputRequest?.schema as
        | { properties?: Record<string, unknown> }
        | undefined;
      const key = schema?.properties ? Object.keys(schema.properties)[0] : undefined;
      return answerStep(taskId, step.id ?? '', key ? { [key]: val } : { answer: val });
    },
    onSuccess: () => {
      setVal('');
      qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });
  return (
    <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] p-2">
      <div className="text-[11px] text-violet-200">
        {step.inputRequest?.prompt ?? 'The service needs more input'}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && val.trim() && send.mutate()}
          className="min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
          placeholder="Your answer…"
        />
        <button
          onClick={() => send.mutate()}
          disabled={send.isPending || !val.trim()}
          className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {send.isPending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/**
 * A live job card in the chat: polls the task and shows each stage visibly — a
 * spinner while running, a progress bar, the question if it needs input, and the
 * delivered output + a download for any result file. No more silent "watch it
 * in Activity".
 */
/**
 * The ONE money path, shared by a manual pay/disburse and a job's provider payment:
 * settle a set of recipients under the rule the buyer picked. Private proves the
 * pinned rule in the browser and releases KEYLESS (no delegate); public spends under
 * the Managed Session. A job passes `hireTaskId` + a `stepId` per recipient so the
 * server links the provider's earnings to the step. Throws a human-readable error on
 * any precondition (no rule, rule not provable on this device, no session).
 */
async function settleUnderRule(opts: {
  lane: 'private' | 'public';
  policyId?: string;
  // The chosen public rule's on-chain id (public lane); omitted = the session's bound rule.
  publicRuleId?: string;
  recipients: { payee: string; amount: number; stepId?: string }[];
  policies: Policy[];
  hireTaskId?: string;
}): Promise<{ total: number; legs: number }> {
  const { lane, policyId, publicRuleId, recipients, policies, hireTaskId } = opts;
  const total = recipients.reduce((s, r) => s + r.amount, 0);
  if (lane === 'public') {
    for (const r of recipients) {
      await managedSessionPay(
        r.payee,
        r.amount,
        publicRuleId || undefined,
        hireTaskId && r.stepId ? { taskId: hireTaskId, stepId: r.stepId } : undefined,
      );
    }
    return { total, legs: recipients.length };
  }
  const p = policyId ? policies.find((x) => x.id === policyId) : undefined;
  if (!p) throw new Error('No private rule selected. Pick one (or create one on the Rules tab).');
  const pinned = await resolvePinnedBundle(p);
  if (!pinned) {
    throw new Error(
      'That rule was created on another device and has no backup, so it cannot be proven here. Re-create it on this device, or pick another.',
    );
  }
  // If a global-private rule is set, the vault requires a SECOND proof against it.
  const globals = await getGlobals();
  let globalBundle: Awaited<ReturnType<typeof resolveGlobalPrivateBundle>> = null;
  if (globals.privateCommitment) {
    globalBundle = await resolveGlobalPrivateBundle(policies, globals.privateCommitment);
    if (!globalBundle) {
      throw new Error(
        'Your global rule was created on another device and cannot be proven here. Re-create it on this device, or clear the global on the Rules tab.',
      );
    }
  }
  const result = await proveAndReleaseBatch({ bundle: pinned, globalBundle, recipients, hireTaskId });
  return { total: result.total, legs: result.legs };
}

// A step that has been delivered + accepted (RELEASED) but not yet paid: the job card
// settles it with settleUnderRule under the rule the buyer picked at hire time, so a
// hire pays the provider ONLY after delivery, through the SAME path a disburse uses.
function unpaidReleased(task: TaskDetail | undefined) {
  return (task?.steps ?? []).filter(
    (s) => s.status === 'RELEASED' && !s.paid && !!s.payee,
  );
}

function JobCard({
  taskId,
  title,
  policyId: propPolicyId,
  publicRuleId: propPublicRuleId,
  lane: propLane,
}: {
  taskId: string;
  title: string;
  policyId?: string;
  publicRuleId?: string;
  lane?: 'private' | 'public';
}) {
  const qc = useQueryClient();
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId),
    refetchInterval: (q) => {
      const t = q.state.data;
      if (!t) return 3000;
      const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status);
      // Keep polling while a delivered step is still awaiting its payment, so the card
      // reflects "paid" right after the client settles it.
      return !terminal || unpaidReleased(t).length > 0 ? 3000 : false;
    },
  });
  // Settle a delivered hire under its rule: pay the provider(s) the moment the work is
  // accepted. busyRef guards against the poll re-triggering a settle already in flight.
  const [settle, setSettle] = useState<{ phase: 'idle' | 'paying' | 'error'; error?: string }>({
    phase: 'idle',
  });
  const busyRef = useRef(false);
  const unpaid = unpaidReleased(task);

  async function paySteps() {
    if (busyRef.current || !task || unpaid.length === 0) return;
    busyRef.current = true;
    setSettle({ phase: 'paying' });
    try {
      // Pay the hired provider(s) with the SAME settlement path a manual disburse
      // uses, under the lane the buyer picked for THIS hire. The recipient is just
      // the service's wallet; private proves + releases keyless, public uses the
      // session. No re-deriving the lane from anywhere.
      await settleUnderRule({
        lane: propLane ?? 'private',
        policyId: propPolicyId ?? task.policyId ?? undefined,
        publicRuleId: propPublicRuleId,
        recipients: unpaid.map((s) => ({
          payee: s.payee as string,
          amount: s.estimatedCost,
          stepId: s.id,
        })),
        policies,
        hireTaskId: taskId,
      });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['vault'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      setSettle({ phase: 'idle' });
    } catch (e) {
      setSettle({ phase: 'error', error: e instanceof Error ? e.message : 'Could not pay the provider.' });
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    if (settle.phase === 'idle' && unpaid.length > 0 && !busyRef.current) void paySteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaid.length, settle.phase, propLane, propPolicyId, policies.length]);

  const paidTotal = (task?.steps ?? [])
    .filter((s) => s.paid)
    .reduce((acc, s) => acc + s.estimatedCost, 0);
  const status = task?.status ?? 'RUNNING';
  const inputStep = task?.steps.find((s) => s.status === 'INPUT_REQUIRED');
  const failed = status === 'FAILED';
  const done = status === 'COMPLETED';
  const awaiting = !!task?.awaitingApproval;
  const running = !done && !failed && !inputStep && !awaiting;
  const progress = task?.steps.find((s) => s.status === 'RUNNING' && s.progress)?.progress;
  const results = task?.steps.filter((s) => s.output || s.artifact) ?? [];
  const label = failed
    ? 'Failed'
    : done
      ? 'Delivered'
      : awaiting
        ? 'Awaiting your approval'
        : inputStep
          ? 'Needs your input'
          : 'Running';
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-white/10 bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {running && <Loader2 size={14} className="animate-spin text-sky-300" />}
          {done && <CheckCircle2 size={14} className="text-emerald-300" />}
          {failed && <AlertTriangle size={14} className="text-red-400" />}
          <span className="truncate">{title}</span>
          <span
            className={`ml-auto shrink-0 text-[11px] ${done ? 'text-emerald-300' : failed ? 'text-red-400' : inputStep ? 'text-violet-300' : 'text-sky-300'}`}
          >
            {label}
          </span>
        </div>
        {progress && (
          <div className="mt-2">
            {typeof progress.pct === 'number' && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400/70 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
                />
              </div>
            )}
            {progress.message && <div className="mt-1 text-[11px] text-sky-300">{progress.message}</div>}
          </div>
        )}
        {inputStep && <InlineAnswer taskId={taskId} step={inputStep} />}
        {failed && (
          <p className="mt-1 text-[11px] text-red-400">
            {task?.steps.find((s) => s.error)?.error ?? 'The job failed.'}
          </p>
        )}
        {results.map((s) => (
          <div key={s.index} className="mt-2 space-y-1">
            {s.artifact && (
              <a
                href={resolveArtifact(s.artifact.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] text-violet-300 hover:bg-white/10"
              >
                <Download size={12} /> Download result · {s.artifact.contentType}
                {s.artifact.size ? ` · ${(s.artifact.size / 1024).toFixed(0)} KB` : ''}
              </a>
            )}
            {s.output && (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px] text-slate-400">
                {s.output}
              </pre>
            )}
          </div>
        ))}
        {settle.phase === 'paying' && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-sky-300">
            <Loader2 size={12} className="animate-spin" /> Paying the provider under your rule…
          </p>
        )}
        {settle.phase === 'error' && (
          <div className="mt-2 rounded-lg bg-amber-500/[0.08] p-2">
            <p className="text-[11px] text-amber-300">{settle.error}</p>
            <button
              onClick={() => setSettle({ phase: 'idle' })}
              className="mt-1 text-[11px] font-medium text-violet-300 hover:text-violet-200"
            >
              Try paying again
            </button>
          </div>
        )}
        {paidTotal > 0 && settle.phase !== 'paying' && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
            <CheckCircle2 size={12} /> Paid ${paidTotal.toFixed(2)} to the provider under your rule.
          </p>
        )}
        <Link
          to={`/app/tasks/${taskId}`}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          View details <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  );
}

function ChatBubble({
  msg,
  onApprove,
  onCancel,
  services,
  onPickService,
}: {
  msg: Msg;
  onApprove: (id: number, plan: Plan) => void;
  onCancel: (id: number) => void;
  services: { id: string; name: string; pricePerCall: number }[];
  onPickService: (msgId: number, serviceId: string) => void;
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
  if (msg.role === 'job') {
    return (
      <JobCard
        taskId={msg.taskId}
        title={msg.title}
        policyId={msg.policyId}
        publicRuleId={msg.publicRuleId}
        lane={msg.lane}
      />
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
        {plan.kind === 'hire' && msg.status === 'pending' && services.length > 0 && (
          <label className="mt-2 block">
            <span className="text-[11px] text-slate-500">Service (change if the agent picked wrong)</span>
            <select
              value={plan.serviceId ?? ''}
              onChange={(e) => onPickService(msg.id, e.target.value)}
              className="mt-0.5 w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (${s.pricePerCall}/call)
                </option>
              ))}
            </select>
          </label>
        )}
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
    // Chain-sourced items (keyless/session spends, deposits) land via the indexer a
    // few seconds after settlement; poll so they appear without a manual refresh.
    refetchInterval: 6000,
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
