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
} from 'lucide-react';
import { getPolicies, createPolicy } from '../../lib/policies';
import { Card, CardHeader, EmptyState, ErrorState, Loading, controls } from '../../components/ui';
import {
  WINDOWS,
  emptyDraft,
  isStellarAddr,
  draftToRules,
  describeDraft,
  describeSavedLimit,
  getDefaultLimitId,
  setDefaultLimitId,
  LIMIT_CACHE_PREFIX,
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
          <div className="mt-2 flex flex-wrap gap-1.5">
            {value.allowlist.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 rounded-lg bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-slate-300"
              >
                {a.slice(0, 6)}…{a.slice(-4)}
                <button
                  onClick={() => set({ allowlist: value.allowlist.filter((x) => x !== a) })}
                  className="text-slate-500 hover:text-red-300"
                  aria-label="Remove"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
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
    </div>
  );
}

const localKey = (commitment: string) => `${LIMIT_CACHE_PREFIX}${commitment}`;

/** Manage reusable spending limits (policies): create with the full builder, list what you have. */
export function LimitsManager() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
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

  const save = useMutation({
    mutationFn: () => {
      const { rules, isPrivate } = draftToRules(draft);
      return createPolicy(rules, isPrivate);
    },
    onSuccess: (p) => {
      if (draft.isPrivate) {
        try {
          localStorage.setItem(localKey(p.commitment), JSON.stringify(draft));
        } catch {
          // ignore
        }
      }
      setDraft(emptyDraft());
      qc.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  const hasAnyRule = !!draft.perPaymentCeiling || !!draft.rollingCap || draft.allowlist.length > 0;

  return (
    <Card className="p-0">
      <CardHeader
        icon={ShieldCheck}
        title="Spending limits"
        hint="Build a rule once, then apply it per instruction on Home. Star one to make it your default."
      />
      <div className="p-5 pt-4">
        <LimitsBuilder value={draft} onChange={setDraft} />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => save.mutate()}
            disabled={!hasAnyRule || save.isPending}
            className={primaryBtn}
          >
            {save.isPending ? 'Saving…' : 'Save limit'}
          </button>
          <span className="text-xs text-slate-500">{describeDraft(draft)}</span>
        </div>
        {save.error && (
          <p className="mt-2 text-sm text-red-400">Could not save the limit. Please try again.</p>
        )}

        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Your saved limits</p>
          {isLoading && <Loading rows={2} />}
          {error && <ErrorState>Could not load your limits.</ErrorState>}
          {!isLoading && !error && policies.length === 0 && <EmptyState>No limits yet.</EmptyState>}
          <div className="space-y-2">
            {policies.map((p) => {
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
                      {p.isPrivate ? 'Private limit' : 'Transparent limit'}
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
