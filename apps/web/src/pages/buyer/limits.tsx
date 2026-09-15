import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, EyeOff, Eye, Users, Gauge, CalendarClock } from 'lucide-react';
import { getPolicies, createPolicy, type Policy } from '../../lib/policies';
import { Card, CardHeader, EmptyState, ErrorState, Loading } from '../../components/ui';
import {
  WINDOWS,
  emptyDraft,
  isStellarAddr,
  draftToRules,
  describeDraft,
  type Draft,
} from './limits-model';

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-500/40';
const primaryBtn =
  'rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all';

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
              className="w-40 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-slate-100 outline-none"
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
            className="rounded-lg border border-white/10 px-3 text-slate-300 hover:bg-white/10 disabled:opacity-40"
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
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-slate-300"
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

      <label className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-slate-300">
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

const localKey = (commitment: string) => `cc:limit:${commitment}`;

function describePolicy(p: Policy): string {
  if (p.rules) {
    const r = p.rules;
    const parts: string[] = [];
    if (r.perPaymentCeilingUsdc != null) parts.push(`max $${r.perPaymentCeilingUsdc}/payment`);
    if (r.rollingCapUsdc != null) parts.push(`max $${r.rollingCapUsdc}/window`);
    if (r.allowlist?.length) parts.push(`${r.allowlist.length} allowed payees`);
    return parts.length ? parts.join(' · ') : 'no caps set';
  }
  // Private: the server did not keep the rule. Show the owner's local copy if we saved one.
  try {
    const cached = localStorage.getItem(localKey(p.commitment));
    if (cached) return `${describeDraft(JSON.parse(cached) as Draft)} (from your device)`;
  } catch {
    // ignore
  }
  return 'private (rule kept off the server)';
}

/** Manage reusable spending limits (policies): create with the full builder, list what you have. */
export function LimitsManager() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const {
    data: policies = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });

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
        hint="Reusable rules the vault enforces on every payment. Apply one per instruction."
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
            {policies.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-slate-200">
                    {p.isPrivate ? (
                      <EyeOff size={13} className="text-violet-300" />
                    ) : (
                      <Eye size={13} className="text-slate-400" />
                    )}
                    {p.isPrivate ? 'Private limit' : 'Transparent limit'}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{describePolicy(p)}</div>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-slate-500">
                  {p.commitment.slice(0, 10)}…
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
