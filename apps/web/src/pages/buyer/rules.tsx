import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Eye,
  Users,
  Gauge,
  CalendarClock,
  Star,
  Sparkles,
  Pencil,
  Anchor,
  Copy,
  X,
  Lock,
  Check,
} from 'lucide-react';
import { getPolicies, createPolicy, deletePolicy, type Policy } from '../../lib/policies';
import { pinCommitment, unpinCommitment, getPinnedCommitments } from '../../lib/vault';
import { computePolicyCommitment } from '../../lib/prove';
import { encryptRuleBundle } from '../../lib/rule-backup';
import { newSalt } from '@clevercon/agent-sdk/prover';
import { CLAUSE_ENFORCEMENT, type ClauseType, type RuleForm } from '@clevercon/common/rule-model';
import { Card, EmptyState, ErrorState, Loading, controls } from '../../components/ui';
import {
  WINDOWS,
  emptyDraft,
  isStellarAddr,
  draftToRules,
  draftToBundleRules,
  draftToRule,
  cacheLocalSalt,
  describeDraft,
  describeSavedLimit,
  getDefaultLimitId,
  setDefaultLimitId,
  LIMIT_CACHE_PREFIX,
  TEMPLATES,
  type Draft,
} from './limits-model';

const inputCls = controls.field;
const primaryBtn = controls.primary;
const localKey = (commitment: string) => `${LIMIT_CACHE_PREFIX}${commitment}`;

/** Surface the real reason a mutation failed (API/wallet errors aren't always Error). */
function errMsg(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'string'
        ? e
        : e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : '';
  if (!raw) return 'Something went wrong. Please try again.';
  const j = raw.indexOf('{');
  if (j >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(j));
      if (parsed?.message) return String(parsed.message);
    } catch {
      /* fall through */
    }
  }
  return raw;
}

// ── Enforcement badge (form-aware + honest) ─────────────────────────────────
// A clause is only "enforced now" in a form its modes include; a private-only
// clause (rolling cap, velocity) on a public rule is NOT enforced there, so we
// say so rather than borrow the private status.
type BadgeKind = 'enforced' | 'pending' | 'app' | 'na';
function clauseBadge(type: ClauseType, form: RuleForm): { label: string; kind: BadgeKind } {
  const e = CLAUSE_ENFORCEMENT[type];
  if (!e.modes.includes(form)) return { label: e.label, kind: 'na' };
  if (e.status === 'enforced-now') return { label: e.label, kind: 'enforced' };
  if (e.status === 'committed-pending') return { label: e.label, kind: 'pending' };
  return { label: e.label, kind: 'app' };
}
const BADGE_STYLE: Record<BadgeKind, string> = {
  enforced: 'bg-emerald-500/15 text-emerald-300',
  pending: 'bg-amber-500/15 text-amber-300',
  app: 'bg-slate-500/15 text-slate-300',
  na: 'bg-white/[0.04] text-slate-500 line-through',
};
const BADGE_TITLE: Record<BadgeKind, string> = {
  enforced: 'Enforced on-chain now',
  pending: 'Committed into the rule; on-chain enforcement pending',
  app: 'Enforced at the app layer (not a cryptographic guarantee)',
  na: 'Not enforced in this form',
};

// ── Human clause chips for a draft ──────────────────────────────────────────
function draftChips(d: Draft): string[] {
  const chips: string[] = [];
  if (d.perPaymentCeiling && d.perPaymentFloor)
    chips.push(`$${d.perPaymentFloor}–$${d.perPaymentCeiling} / payment`);
  else if (d.perPaymentCeiling) chips.push(`≤ $${d.perPaymentCeiling} / payment`);
  else if (d.perPaymentFloor) chips.push(`≥ $${d.perPaymentFloor} / payment`);
  if (d.rollingCap) chips.push(`$${d.rollingCap} ${WINDOWS[d.rollingWindow].label}`);
  if (d.velocityCount) chips.push(`≤ ${d.velocityCount} ${WINDOWS[d.velocityWindow].label}`);
  chips.push(d.allowlist.length ? `${d.allowlist.length} approved payee(s)` : 'any payee in caps');
  return chips;
}

function cachedDraft(commitment: string): Draft | null {
  try {
    const raw = localStorage.getItem(localKey(commitment));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

// ── The rule builder (clauses) ──────────────────────────────────────────────
export function RuleBuilder({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const [addr, setAddr] = useState('');
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
  const form: RuleForm = value.isPrivate ? 'private' : 'public';
  const addAddr = () => {
    const a = addr.trim();
    if (isStellarAddr(a) && !value.allowlist.includes(a)) {
      set({ allowlist: [...value.allowlist, a] });
      setAddr('');
    }
  };
  const activeClauses = draftToRule(value).clauses;

  return (
    <div className="space-y-5">
      {/* Form selector: private (proven) vs public (key-checked). */}
      <div>
        <span className="mb-1.5 block text-xs font-medium text-slate-400">Rule form</span>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              {
                v: true,
                icon: Lock,
                title: 'Private',
                blurb: 'Hidden rule, proven per payment (ZK). The default.',
              },
              {
                v: false,
                icon: Eye,
                title: 'Public',
                blurb: 'Transparent scope a session key spends under.',
              },
            ] as const
          ).map((o) => {
            const active = value.isPrivate === o.v;
            return (
              <button
                key={o.title}
                type="button"
                onClick={() => set({ isPrivate: o.v })}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? 'border-violet-500/50 bg-violet-500/[0.08]'
                    : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <o.icon
                  size={16}
                  className={active ? 'mt-0.5 text-violet-300' : 'mt-0.5 text-slate-500'}
                />
                <span>
                  <span
                    className={`block text-sm font-semibold ${active ? 'text-white' : 'text-slate-300'}`}
                  >
                    {o.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    {o.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!value.isPrivate && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300/80">
            Public rules are spent by a bounded session key. Rolling cap and velocity are enforced
            only in the private lane; a public rule&apos;s hands-off spend is bounded by its Managed
            Session budget (set one on the Vault tab).
          </p>
        )}
      </div>

      {/* Templates */}
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
          <Sparkles size={13} className="text-violet-300" /> Start from a template
        </span>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange({ ...t.make(), isPrivate: value.isPrivate })}
              title={t.description}
              className={controls.chip}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Gauge size={13} className="text-violet-300" /> Max per payment (USDC)
          </span>
          <input
            value={value.perPaymentCeiling}
            onChange={(e) => set({ perPaymentCeiling: e.target.value.replace(/[^0-9.]/g, '') })}
            inputMode="decimal"
            placeholder="e.g. 100 (blank = no cap)"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Gauge size={13} className="text-violet-300" /> Min per payment (USDC)
          </span>
          <input
            value={value.perPaymentFloor ?? ''}
            onChange={(e) => set({ perPaymentFloor: e.target.value.replace(/[^0-9.]/g, '') })}
            inputMode="decimal"
            placeholder="blank = none; = max → exact"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarClock size={13} className="text-violet-300" /> Rolling budget
          </span>
          <div className="flex gap-2">
            <input
              value={value.rollingCap}
              onChange={(e) => set({ rollingCap: e.target.value.replace(/[^0-9.]/g, '') })}
              inputMode="decimal"
              placeholder="e.g. 500"
              className={inputCls}
            />
            <select
              value={value.rollingWindow}
              onChange={(e) => set({ rollingWindow: e.target.value as keyof typeof WINDOWS })}
              className="w-36 rounded-lg bg-black/30 px-2 py-2 text-sm text-slate-100 outline-none"
              aria-label="Rolling window"
            >
              {Object.entries(WINDOWS).map(([k, w]) => (
                <option key={k} value={k}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Gauge size={13} className="text-violet-300" /> Max payments
          </span>
          <div className="flex gap-2">
            <input
              value={value.velocityCount}
              onChange={(e) => set({ velocityCount: e.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              placeholder="e.g. 5 (blank = none)"
              className={inputCls}
            />
            <select
              value={value.velocityWindow}
              onChange={(e) => set({ velocityWindow: e.target.value as keyof typeof WINDOWS })}
              className="w-36 rounded-lg bg-black/30 px-2 py-2 text-sm text-slate-100 outline-none"
              aria-label="Velocity window"
            >
              {Object.entries(WINDOWS)
                .filter(([k]) => k !== 'none')
                .map(([k, w]) => (
                  <option key={k} value={k}>
                    {w.label}
                  </option>
                ))}
            </select>
          </div>
        </label>
      </div>

      {/* Allowlist */}
      <div>
        <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
          <Users size={13} className="text-violet-300" /> Approved payees (allowlist)
        </span>
        <div className="flex gap-2">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAddr())}
            placeholder="Add a Stellar address (G…)"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addAddr}
            disabled={!isStellarAddr(addr)}
            className="rounded-lg bg-white/[0.05] px-3 text-slate-300 hover:bg-white/10 disabled:opacity-40"
            aria-label="Add payee"
          >
            <Plus size={15} />
          </button>
        </div>
        {value.allowlist.length === 0 ? (
          <p className="mt-1 text-[11px] text-slate-600">
            Empty = any address within the caps. Add addresses to restrict payments to only those.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {value.allowlist.map((a) => (
              <div
                key={a}
                className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5"
              >
                <span className="font-mono text-[11px] text-slate-300">
                  {a.slice(0, 6)}…{a.slice(-4)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-slate-600">max $</span>
                  <input
                    value={value.allowlistCaps[a] ?? ''}
                    onChange={(e) =>
                      set({
                        allowlistCaps: {
                          ...value.allowlistCaps,
                          [a]: e.target.value.replace(/[^0-9.]/g, ''),
                        },
                      })
                    }
                    inputMode="decimal"
                    placeholder="any"
                    className="w-20 rounded-md bg-black/30 px-2 py-1 text-right text-[11px] text-slate-100 outline-none"
                    aria-label={`Per-payee cap for ${a.slice(0, 6)}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        allowlist: value.allowlist.filter((x) => x !== a),
                        allowlistCaps: Object.fromEntries(
                          Object.entries(value.allowlistCaps).filter(([k]) => k !== a),
                        ),
                      })
                    }
                    className="text-slate-500 hover:text-red-300"
                    aria-label="Remove payee"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live enforcement badges (form-aware) */}
      {activeClauses.length > 0 && (
        <div>
          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-500">
            On-chain enforcement in this form
          </span>
          <div className="flex flex-wrap gap-1.5">
            {activeClauses.map((c, i) => {
              const b = clauseBadge(c.type as ClauseType, form);
              return (
                <span
                  key={i}
                  title={BADGE_TITLE[b.kind]}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${BADGE_STYLE[b.kind]}`}
                >
                  {b.label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Lock background scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  // Portal to <body> so the modal escapes the page's `cc-stagger` transform (a
  // transformed ancestor would make `position: fixed` relative to it, clipping
  // the modal instead of filling the viewport).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="cc-card my-4 w-full max-w-xl rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── Copy field + the post-create "provision your agent" reveal ──────────────
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all font-mono text-slate-300">
        {value}
      </pre>
    </div>
  );
}

/**
 * Shown once right after a PRIVATE rule is created: the salt (the only secret) +
 * the exact bundle to paste into an agent's SDK/MCP config. The plan's copy-once
 * salt reveal: the server never holds the salt in cleartext; the agent does.
 */
function RevealPanel({
  reveal,
  onDone,
}: {
  reveal: { commitment: string; salt: string; bundleJson: string };
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-300" />
        <p className="text-[12.5px] leading-relaxed text-slate-300">
          Private rule created. To let an agent spend under it, provision the bundle below into your
          agent&apos;s SDK or MCP config. The <span className="text-violet-300">salt</span> is the
          secret that lets the agent prove; it is also backed up encrypted under your wallet, so you
          can recover it by reconnecting on any device. Keep it private.
        </p>
      </div>

      <CopyRow label="Commitment · public id, pinned on-chain" value={reveal.commitment} />
      <CopyRow label="Salt · secret" value={reveal.salt} />
      <CopyRow label="Agent config · { rules, salt }" value={reveal.bundleJson} />

      <div className="rounded-xl bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
        <div className="mb-1 font-medium text-slate-300">Use it with an agent</div>
        <div className="font-mono text-[11px] text-slate-400">
          MCP: set <span className="text-violet-300">CLEVERCON_POLICY_JSON</span> to the config
          above.
          <br />
          SDK: <span className="text-violet-300">createSpender(&#123; policyBundle &#125;)</span>,
          then <span className="text-violet-300">disbursePrivate(lines)</span>.
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
        <span className="mr-auto text-[11px] text-amber-300/80">
          Next: pin this rule on-chain to use it.
        </span>
        <button onClick={onDone} className={primaryBtn}>
          Done
        </button>
      </div>
    </div>
  );
}

// ── A single rule card ──────────────────────────────────────────────────────
function RuleCard({
  p,
  isDefault,
  pinned,
  onDefault,
  onPin,
  onUnpin,
  onEdit,
  onDuplicate,
  onDelete,
  pinBusy,
}: {
  p: Policy;
  isDefault: boolean;
  pinned: boolean;
  onDefault: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  pinBusy: boolean;
}) {
  const priv = p.form ? p.form === 'private' : p.isPrivate;
  const form: RuleForm = priv ? 'private' : 'public';
  const draft = cachedDraft(p.commitment);
  const chips = draft ? draftChips(draft) : null;
  const clauses = draft ? draftToRule(draft).clauses : [];

  return (
    <Card className={`flex flex-col p-0 ${pinned ? '' : 'opacity-[0.96]'}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
              priv
                ? 'bg-violet-500/10 text-violet-300 ring-violet-500/15'
                : 'bg-sky-500/10 text-sky-300 ring-sky-500/15'
            }`}
          >
            {priv ? <Lock size={16} /> : <Eye size={16} />}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold text-white">
                {p.name || (priv ? 'Private rule' : 'Public rule')}
              </span>
              {typeof p.version === 'number' && p.version > 1 && (
                <span className="text-[10px] text-slate-500">v{p.version}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  priv ? 'bg-violet-500/15 text-violet-300' : 'bg-sky-500/15 text-sky-300'
                }`}
              >
                {priv ? 'Private' : 'Public'}
              </span>
              {pinned ? (
                <span
                  title="Pinned on-chain: this rule is live and can authorize spends."
                  className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300"
                >
                  <Anchor size={9} /> Pinned
                </span>
              ) : (
                <span
                  title="Not pinned. Pin this rule on-chain (one wallet signature) before it can authorize a spend."
                  className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
                >
                  Pin to use
                </span>
              )}
              {isDefault && (
                <span
                  title="Pre-selected for new instructions on the Agent and Disburse tabs. Not a lock; you can override per spend."
                  className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300"
                >
                  Default
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onDefault}
          title={
            isDefault
              ? 'Remove as default'
              : 'Make default (pre-selects this rule for new instructions)'
          }
          aria-label={isDefault ? 'Remove as default' : 'Make default'}
          className={isDefault ? 'text-amber-300' : 'text-slate-600 hover:text-slate-300'}
        >
          <Star size={16} fill={isDefault ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="flex-1 px-4 py-3">
        {chips ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span
                key={i}
                className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11.5px] text-slate-300"
              >
                {c}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-slate-500">{describeSavedLimit(p)}</p>
        )}

        {clauses.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {clauses.map((c, i) => {
              const b = clauseBadge(c.type as ClauseType, form);
              return (
                <span
                  key={i}
                  title={`${b.label}: ${BADGE_TITLE[b.kind]}`}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${BADGE_STYLE[b.kind]}`}
                >
                  {b.kind === 'enforced' && <Check size={9} />}
                  {b.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
        {pinned ? (
          <button
            onClick={onUnpin}
            disabled={pinBusy}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
            title="Unpin on-chain (wallet signs unpin_policy_commitment)"
          >
            <Anchor size={13} /> {pinBusy ? 'Unpinning…' : 'Unpin'}
          </button>
        ) : (
          <button
            onClick={onPin}
            disabled={pinBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-2.5 py-1 text-[11.5px] font-medium text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
            title="Pin on-chain (wallet signs set_policy_commitment) so this rule can authorize spends"
          >
            <Anchor size={13} /> {pinBusy ? 'Pinning…' : 'Pin on-chain'}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            title="Edit (saves a new version)"
            aria-label="Edit rule"
            className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDuplicate}
            title={`Duplicate as ${priv ? 'public' : 'private'}`}
            aria-label="Duplicate in the other form"
            className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={onDelete}
            title="Delete this saved rule"
            aria-label="Delete rule"
            className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-red-300"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── The Rules manager ───────────────────────────────────────────────────────
export function RulesManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Set after a PRIVATE rule is created, to show the copy-once salt reveal.
  const [reveal, setReveal] = useState<null | {
    commitment: string;
    salt: string;
    bundleJson: string;
  }>(null);
  const [formFilter, setFormFilter] = useState<'all' | 'private' | 'public'>('all');
  const [defaultId, setDefaultId] = useState<string>(() => getDefaultLimitId());
  const {
    data: policies = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  // Which saved rules are actually PINNED on-chain (and thus usable). Read from
  // the vault's pinned set so a card can show live/not-live honestly.
  const { data: pinnedList = [] } = useQuery({
    queryKey: ['pinned-commitments'],
    queryFn: getPinnedCommitments,
  });
  const pinnedSet = new Set(pinnedList.map((c) => c.toLowerCase()));

  const toggleDefault = (id: string) => {
    const next = defaultId === id ? '' : id;
    setDefaultId(next);
    setDefaultLimitId(next);
  };

  const openNew = () => {
    save.reset(); // clear any stale error from a prior attempt
    setReveal(null);
    setDraft(emptyDraft());
    setName('');
    setEditingId(null);
    setOpen(true);
  };
  const openEdit = (p: Policy) => {
    save.reset();
    setReveal(null);
    const d = cachedDraft(p.commitment);
    setDraft(d ?? emptyDraft());
    setName(p.name ?? '');
    setEditingId(p.id);
    setOpen(true);
  };
  const openDuplicate = (p: Policy) => {
    save.reset();
    setReveal(null);
    const d = cachedDraft(p.commitment) ?? emptyDraft();
    const priv = p.form ? p.form === 'private' : p.isPrivate;
    setDraft({ ...d, isPrivate: !priv }); // duplicate into the OTHER form
    setName(p.name ? `${p.name} (${priv ? 'public' : 'private'})` : '');
    setEditingId(null);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const { rules, isPrivate } = draftToRules(draft);
      const base = {
        name: name.trim() || undefined,
        form: (draft.isPrivate ? 'private' : 'public') as 'private' | 'public',
        supersedes: editingId ?? undefined,
      };
      if (!isPrivate) return { policy: await createPolicy(rules, false, base), salt: null };
      // Private rule: pin the CANONICAL pp/2 commitment from the full bundle + a
      // stable device salt, and hand the server a wallet-encrypted {rules,salt}
      // backup it cannot read (cross-device recovery). Unchanged from before.
      const bundleRules = draftToBundleRules(draft);
      const salt = newSalt();
      const commitment = await computePolicyCommitment(bundleRules, salt);
      // The wallet-encrypted cross-device backup is best-effort: if the wallet
      // prompt is declined or errors, still create the rule (saved + re-provable on
      // THIS device via the local salt cache) rather than block creation on it.
      let encryptedBackup: string | undefined;
      try {
        encryptedBackup = await encryptRuleBundle({ rules: bundleRules, salt });
      } catch {
        encryptedBackup = undefined;
      }
      const policy = await createPolicy(rules, true, {
        ...base,
        commitment,
        ...(encryptedBackup ? { encryptedBackup } : {}),
      });
      return { policy, salt };
    },
    onSuccess: ({ policy: p, salt }) => {
      try {
        localStorage.setItem(localKey(p.commitment), JSON.stringify(draft));
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ['policies'] });
      if (salt) {
        // Private rule: cache the salt locally, then show the copy-once reveal so
        // the owner can provision an agent. Keep the modal open for it.
        cacheLocalSalt(p.commitment, salt);
        const bundle = { rules: draftToBundleRules(draft), salt };
        setReveal({
          commitment: p.commitment,
          salt,
          bundleJson: JSON.stringify(bundle, null, 2),
        });
        return;
      }
      setOpen(false);
      setDraft(emptyDraft());
      setName('');
      setEditingId(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });
  const pin = useMutation({
    mutationFn: (commitment: string) => pinCommitment(commitment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      qc.invalidateQueries({ queryKey: ['pinned-commitments'] });
    },
  });
  const unpin = useMutation({
    mutationFn: (commitment: string) => unpinCommitment(commitment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinned-commitments'] }),
  });

  const activePolicies = policies.filter((p) => p.status !== 'archived');
  const lane = (p: Policy): 'private' | 'public' => p.form ?? (p.isPrivate ? 'private' : 'public');
  const shown =
    formFilter === 'all' ? activePolicies : activePolicies.filter((p) => lane(p) === formFilter);
  const hasAnyRule =
    !!draft.perPaymentCeiling ||
    !!draft.rollingCap ||
    !!draft.velocityCount ||
    draft.allowlist.length > 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['all', 'private', 'public'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors ${
                formFilter === f
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {f}
              {f !== 'all' && (
                <span className="ml-1.5 text-slate-600">
                  {activePolicies.filter((p) => lane(p) === f).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={openNew} className={primaryBtn}>
          <Plus size={15} /> New rule
        </button>
      </div>

      {isLoading && <Loading rows={2} />}
      {error && <ErrorState>Could not load your rules.</ErrorState>}
      {!isLoading && !error && shown.length === 0 && (
        <EmptyState>
          {activePolicies.length === 0
            ? 'No rules yet. Create one to bound what your agent can spend.'
            : `No ${formFilter} rules.`}
        </EmptyState>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((p) => (
          <RuleCard
            key={p.id}
            p={p}
            isDefault={defaultId === p.id}
            pinned={pinnedSet.has(p.commitment.toLowerCase())}
            onDefault={() => toggleDefault(p.id)}
            onPin={() => pin.mutate(p.commitment)}
            onUnpin={() => unpin.mutate(p.commitment)}
            onEdit={() => openEdit(p)}
            onDuplicate={() => openDuplicate(p)}
            onDelete={() => {
              if (
                window.confirm(
                  `Delete "${p.name || 'this rule'}"? This removes the saved rule; the on-chain commitment stays immutable, and if pinned you should unpin it first.`,
                )
              )
                del.mutate(p.id);
            }}
            pinBusy={pin.isPending || unpin.isPending}
          />
        ))}
      </div>

      {(pin.error || unpin.error) && (
        <p className="mt-3 text-sm text-red-400">{errMsg(pin.error || unpin.error)}</p>
      )}
      {del.error && <p className="mt-3 text-sm text-red-400">{errMsg(del.error)}</p>}

      {open && (
        <Modal
          title={
            reveal
              ? 'Rule created · provision your agent'
              : editingId
                ? 'Edit rule (saves a new version)'
                : 'New rule'
          }
          onClose={() => {
            setOpen(false);
            setReveal(null);
            save.reset();
          }}
        >
          {reveal ? (
            <RevealPanel
              reveal={reveal}
              onDone={() => {
                setOpen(false);
                setReveal(null);
                setDraft(emptyDraft());
                setName('');
                setEditingId(null);
              }}
            />
          ) : (
            <>
              <label className="mb-4 block">
                <span className="mb-1 block text-xs text-slate-400">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Payroll, Agent allowance, API budget"
                  className={inputCls}
                />
              </label>
              <RuleBuilder value={draft} onChange={setDraft} />
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                <span className="text-[11px] text-slate-500">{describeDraft(draft)}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={controls.secondary}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => save.mutate()}
                    disabled={!hasAnyRule || save.isPending}
                    className={primaryBtn}
                  >
                    {save.isPending ? 'Saving…' : editingId ? 'Save new version' : 'Save rule'}
                  </button>
                </div>
              </div>
              {save.error && <p className="mt-2 text-sm text-red-400">{errMsg(save.error)}</p>}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export function RulesPage() {
  return (
    <div className="cc-stagger max-w-5xl space-y-6">
      <header>
        <p className="cc-eyebrow">Spending policy</p>
        <h1 className="cc-title mt-2">Rules</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          The boundaries your agent cannot cross. A rule is{' '}
          <span className="text-violet-300">private</span> (hidden, proven per payment) or{' '}
          <span className="text-sky-300">public</span> (a transparent scope a session key spends
          under). Pin a rule on-chain to use it; star one as your default.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            ic: Lock,
            t: 'Private by default',
            d: 'Only a commitment is on-chain; the rule is never published.',
          },
          {
            ic: ShieldCheck,
            t: 'Enforced on-chain',
            d: 'The vault checks every spend against the rule, cryptographically.',
          },
          {
            ic: Anchor,
            t: 'Pinned by you',
            d: 'Only your wallet signature can pin or change a rule.',
          },
        ].map((s, i) => (
          <div key={i} className="cc-card flex items-start gap-3 p-4">
            <span className="cc-ic">
              <s.ic size={17} />
            </span>
            <div>
              <div className="text-[13.5px] font-semibold text-white">{s.t}</div>
              <div className="mt-0.5 text-xs text-slate-500">{s.d}</div>
            </div>
          </div>
        ))}
      </div>

      <RulesManager />
    </div>
  );
}
