import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Plus,
  Trash2,
  EyeOff,
  Eye,
  Users,
  Gauge,
  CalendarClock,
  Star,
  Sparkles,
  Archive,
  Pencil,
  Anchor,
} from 'lucide-react';
import { getPolicies, createPolicy, archivePolicy, type Policy } from '../../lib/policies';
import { pinCommitment } from '../../lib/vault';
import { computePolicyCommitment } from '../../lib/prove';
import { encryptRuleBundle } from '../../lib/rule-backup';
import { newSalt } from '@clevercon/agent-sdk/prover';
import { Card, CardHeader, EmptyState, ErrorState, Loading, controls } from '../../components/ui';
import {
  WINDOWS,
  emptyDraft,
  isStellarAddr,
  draftToRules,
  draftToBundleRules,
  cacheLocalSalt,
  describeDraft,
  describeSavedLimit,
  getDefaultLimitId,
  setDefaultLimitId,
  LIMIT_CACHE_PREFIX,
  TEMPLATES,
  draftClauseBadges,
  enforcementText,
  type Draft,
} from './limits-model';

const inputCls = controls.field;
const primaryBtn = controls.primary;

/** The full limits form: what the vault will enforce on every payment. */
export function LimitsBuilder({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const [addr, setAddr] = useState('');
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
  const addAddr = () => {
    const a = addr.trim();
    if (isStellarAddr(a) && !value.allowlist.includes(a)) {
      set({ allowlist: [...value.allowlist, a] });
      setAddr('');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
          <Sparkles size={13} className="text-violet-300" /> Start from a template
        </span>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.make())}
              title={t.description}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.08]"
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
            placeholder="e.g. 100 (blank = no per-payment cap)"
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
            placeholder="blank = no floor; equal to max = exact amount"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarClock size={13} className="text-violet-300" /> Rolling cap
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
              className="w-40 rounded-lg bg-black/30 px-2 py-2 text-sm text-slate-100 outline-none"
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
      </div>

      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
          <Gauge size={13} className="text-violet-300" /> Max number of payments
        </span>
        <div className="flex gap-2">
          <input
            value={value.velocityCount}
            onChange={(e) => set({ velocityCount: e.target.value.replace(/[^0-9]/g, '') })}
            inputMode="numeric"
            placeholder="e.g. 5 (blank = no count limit)"
            className={inputCls}
          />
          <select
            value={value.velocityWindow}
            onChange={(e) => set({ velocityWindow: e.target.value as keyof typeof WINDOWS })}
            className="w-40 rounded-lg bg-black/30 px-2 py-2 text-sm text-slate-100 outline-none"
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
        <span className="mt-1 block text-[11px] text-slate-600">
          Caps how often a payment can go out (for example, at most 5 per week), proven on-chain
          alongside the amount caps.
        </span>
      </label>

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
            Empty = the agent may pay any address, bounded only by the caps above. Add addresses to
            restrict it to only those.
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
                    aria-label={`Per-payment cap for payee ${a.slice(0, 6)}`}
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
            <p className="text-[11px] text-slate-600">
              Leave &ldquo;max $&rdquo; blank to apply only the global ceiling, or set it to cap a
              specific payee tighter (R5). Proven on-chain per payee.
            </p>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-white/[0.04] p-3 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={value.isPrivate}
          onChange={(e) => set({ isPrivate: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            {value.isPrivate ? <EyeOff size={13} className="text-violet-300" /> : <Eye size={13} />}
            Keep this rule private
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Only a commitment (a hash) is stored on-chain; the caps and allowlist are never kept by
            the server. Payments are still public in v1, but the rule that governs them stays
            hidden.
          </span>
        </span>
      </label>

      {draftClauseBadges(value).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-500">On-chain enforcement:</span>
          {draftClauseBadges(value).map((b, i) => (
            <span
              key={i}
              title={`${b.label}: ${enforcementText(b.status)}`}
              className={
                'rounded-md px-1.5 py-0.5 ' +
                (b.status === 'enforced-now'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : b.status === 'committed-pending'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-slate-500/15 text-slate-300')
              }
            >
              {b.label} · {enforcementText(b.status)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const localKey = (commitment: string) => `${LIMIT_CACHE_PREFIX}${commitment}`;

/** Manage reusable spending limits (policies): create with the full builder, list what you have. */
export function LimitsManager() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formFilter, setFormFilter] = useState<'all' | 'private' | 'public'>('all');
  const [defaultId, setDefaultId] = useState<string>(() => getDefaultLimitId());
  const {
    data: policies = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });

  // Toggle which saved limit is the owner's default (pre-fills each instruction on Home).
  const toggleDefault = (id: string) => {
    const next = defaultId === id ? '' : id;
    setDefaultId(next);
    setDefaultLimitId(next);
  };

  const resetForm = () => {
    setDraft(emptyDraft());
    setName('');
    setEditingId(null);
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
      // Private rule: the commitment the owner pins must be the canonical pp/2
      // value computed from the FULL prover bundle + a stable device salt, so a
      // later disburse proving the same bundle reproduces it. Compute it here,
      // encrypt {rules, salt} under a wallet-derived key for cross-device backup,
      // and hand both to the server (which stores them but cannot read the backup).
      const bundleRules = draftToBundleRules(draft);
      const salt = newSalt();
      const commitment = await computePolicyCommitment(bundleRules, salt);
      const encryptedBackup = await encryptRuleBundle({ rules: bundleRules, salt });
      const policy = await createPolicy(rules, true, { ...base, commitment, encryptedBackup });
      return { policy, salt };
    },
    onSuccess: ({ policy: p, salt }) => {
      // Cache the plaintext draft on this device for every limit: private limits
      // need it (the server keeps only a commitment), and even transparent ones
      // carry device-local rules (velocity today, per-payee caps next) the server
      // shape does not. It never leaves the browser. Private limits also cache the
      // salt so this device can re-prove with no wallet prompt.
      try {
        localStorage.setItem(localKey(p.commitment), JSON.stringify(draft));
      } catch {
        // ignore
      }
      if (salt) cacheLocalSalt(p.commitment, salt);
      resetForm();
      qc.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  // Editing a committed rule never mutates it in place: archive the old, create a
  // new version that supersedes it.
  const archive = useMutation({
    mutationFn: (id: string) => archivePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  // Pin a rule's commitment on-chain (set_policy_commitment): the wallet signs,
  // and the proof-gated release path then accepts the rule. One signed act per
  // rule the operator cannot forge or bypass.
  const pin = useMutation({
    mutationFn: (commitment: string) => pinCommitment(commitment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  // Load a saved limit's device-cached rule back into the builder to edit it;
  // saving then mints a new version that supersedes the original.
  const loadForEdit = (p: Policy) => {
    try {
      const cached = localStorage.getItem(localKey(p.commitment));
      if (cached) setDraft(JSON.parse(cached) as Draft);
    } catch {
      // ignore; keep whatever is in the builder
    }
    setName(p.name ?? '');
    setEditingId(p.id);
  };

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
    <Card className="p-0">
      <CardHeader
        icon={ShieldCheck}
        title="Spending limits"
        hint="Build a rule once, then apply it per instruction on Home. Star one to make it your default."
      />
      <div className="p-5 pt-4">
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-slate-400">Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Payroll, Agent allowance, API budget"
            className={inputCls}
          />
        </label>
        <LimitsBuilder value={draft} onChange={setDraft} />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => save.mutate()}
            disabled={!hasAnyRule || save.isPending}
            className={primaryBtn}
          >
            {save.isPending ? 'Saving…' : editingId ? 'Save new version' : 'Save limit'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel edit
            </button>
          )}
          <span className="text-xs text-slate-500">{describeDraft(draft)}</span>
        </div>
        {save.error && (
          <p className="mt-2 text-sm text-red-400">Could not save the limit. Please try again.</p>
        )}

        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Your saved limits</p>
          <div className="mb-2 flex gap-1.5">
            {(['all', 'private', 'public'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormFilter(f)}
                className={
                  'rounded-md px-2 py-0.5 text-[11px] capitalize ' +
                  (formFilter === f
                    ? 'bg-violet-500/20 text-violet-200'
                    : 'text-slate-500 hover:text-slate-300')
                }
              >
                {f}
              </button>
            ))}
          </div>
          {isLoading && <Loading rows={2} />}
          {error && <ErrorState>Could not load your limits.</ErrorState>}
          {!isLoading && !error && shown.length === 0 && (
            <EmptyState>
              {activePolicies.length === 0 ? 'No limits yet.' : `No ${formFilter} limits.`}
            </EmptyState>
          )}
          <div className="space-y-2">
            {shown.map((p) => {
              const isDefault = defaultId === p.id;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${
                    isDefault
                      ? 'border-violet-500/40 bg-violet-500/[0.06]'
                      : 'border-white/[0.08] bg-white/[0.02]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-slate-200">
                      {p.isPrivate ? (
                        <EyeOff size={13} className="text-violet-300" />
                      ) : (
                        <Eye size={13} className="text-slate-400" />
                      )}
                      {p.name || (p.isPrivate ? 'Private limit' : 'Transparent limit')}
                      {typeof p.version === 'number' && p.version > 1 && (
                        <span className="text-[10px] text-slate-500">v{p.version}</span>
                      )}
                      {p.global && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                          Global
                        </span>
                      )}
                      {isDefault && (
                        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {describeSavedLimit(p)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => toggleDefault(p.id)}
                      title={isDefault ? 'Remove as default' : 'Make default'}
                      aria-label={isDefault ? 'Remove as default' : 'Make default'}
                      className={
                        isDefault ? 'text-violet-300' : 'text-slate-600 hover:text-slate-300'
                      }
                    >
                      <Star size={15} fill={isDefault ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => pin.mutate(p.commitment)}
                      disabled={pin.isPending}
                      title="Pin on-chain (wallet signs set_policy_commitment)"
                      aria-label="Pin on-chain"
                      className="text-slate-600 hover:text-violet-300 disabled:opacity-40"
                    >
                      <Anchor size={14} />
                    </button>
                    <button
                      onClick={() => loadForEdit(p)}
                      title="Edit (saves a new version)"
                      aria-label="Edit limit"
                      className="text-slate-600 hover:text-slate-300"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => archive.mutate(p.id)}
                      disabled={archive.isPending}
                      title="Archive"
                      aria-label="Archive limit"
                      className="text-slate-600 hover:text-red-300 disabled:opacity-40"
                    >
                      <Archive size={14} />
                    </button>
                    <span className="font-mono text-[11px] text-slate-500">
                      {p.commitment.slice(0, 10)}…
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
