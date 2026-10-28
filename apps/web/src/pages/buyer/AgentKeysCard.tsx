import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keypair } from '@stellar/stellar-sdk';
import { KeyRound, Copy, Check, Trash2 } from 'lucide-react';
import { getPolicies, type Policy } from '../../lib/policies';
import {
  getPublicRule,
  getAgentKey,
  registerAgentKey,
  pauseAgentKey,
  revokeAgentKey,
} from '../../lib/vault';
import { isDemo } from '../../config';
import { Card, CardHeader, controls } from '../../components/ui';

const inputCls = controls.field;
const primaryBtn = controls.primary;

// A self-custody agent key the owner authorized, remembered on THIS device so the
// dapp can list + manage it (the chain is not indexed by owner). The secret is never
// stored - only the public key + what it was bound to.
type StoredKey = { publicKey: string; label: string; ruleId: string; createdAt: string };
const STORE = 'cc:agent-keys';
function loadKeys(): StoredKey[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]') as StoredKey[];
  } catch {
    return [];
  }
}
function saveKeys(keys: StoredKey[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(keys));
  } catch {
    // ignore
  }
}

function readErr(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const j = raw.indexOf('{');
  if (j >= 0) {
    try {
      const p = JSON.parse(raw.slice(j)) as { message?: unknown };
      if (p?.message) return String(p.message);
    } catch {
      /* ignore */
    }
  }
  return raw || 'Something went wrong.';
}

function CopyLine({ label, value }: { label: string; value: string }) {
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
          className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-32 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] break-all whitespace-pre-wrap text-slate-300">
        {value}
      </pre>
    </div>
  );
}

type Reveal =
  | { kind: 'generated'; secret: string; publicKey: string }
  | { kind: 'pasted'; publicKey: string };

/** A single authorized agent key, with its live on-chain scope + pause/revoke. */
function AgentKeyRow({ k, onForget }: { k: StoredKey; onForget: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['agent-key', k.publicKey],
    queryFn: () => getAgentKey(k.publicKey),
  });
  const s = data?.session ?? null;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['agent-key', k.publicKey] });
  const pause = useMutation({
    mutationFn: (p: boolean) => pauseAgentKey(k.publicKey, p),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: () => revokeAgentKey(k.publicKey),
    onSuccess: () => {
      invalidate();
      onForget();
    },
  });
  const busy = pause.isPending || revoke.isPending;

  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-white">{k.label || 'Agent key'}</div>
          <div className="truncate font-mono text-[11px] text-slate-500" title={k.publicKey}>
            {k.publicKey.slice(0, 8)}…{k.publicKey.slice(-6)}
          </div>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
            !s
              ? 'bg-slate-500/15 text-slate-400'
              : s.paused
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {!s ? 'not live' : s.paused ? 'paused' : 'active'}
        </span>
      </div>
      {s && (
        <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
          <div>
            <div className="text-slate-500">Cap left</div>
            <div className="text-emerald-300">
              {s.spendCapUsdc > 0 ? `${s.remainingUsdc.toFixed(2)} USDC` : 'no cap'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Spent</div>
            <div className="text-slate-300">{s.spentUsdc.toFixed(2)} USDC</div>
          </div>
          <div>
            <div className="text-slate-500">Payments</div>
            <div className="text-slate-300">{s.releaseCount}</div>
          </div>
        </div>
      )}
      <div className="mt-2.5 flex gap-2">
        {s && (
          <button
            onClick={() => !busy && pause.mutate(!s.paused)}
            disabled={busy}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
          >
            {pause.isPending ? '…' : s.paused ? 'Unpause' : 'Pause'}
          </button>
        )}
        <button
          onClick={() => {
            const msg = s
              ? 'Revoke this agent key on-chain? It can spend nothing after (one wallet signature).'
              : 'Remove this key from the list?';
            if (!window.confirm(msg)) return;
            if (s) revoke.mutate();
            else onForget();
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1 text-[11.5px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 size={12} /> {revoke.isPending ? 'Revoking…' : s ? 'Revoke' : 'Forget'}
        </button>
      </div>
      {(pause.error || revoke.error) && (
        <p className="mt-1.5 text-[11px] text-red-400">{readErr(pause.error || revoke.error)}</p>
      )}
    </div>
  );
}

export function AgentKeysCard() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'generate' | 'paste'>('generate');
  const [label, setLabel] = useState('');
  const [pasted, setPasted] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [cap, setCap] = useState('');
  const [hours, setHours] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [keys, setKeys] = useState<StoredKey[]>(() => loadKeys());

  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const publicPolicies = policies.filter(
    (p: Policy) => (p.form === 'public' || (!p.form && !p.isPrivate)) && p.status !== 'archived',
  );
  // Only LIVE public rules are selectable (the vault rejects an unpinned one).
  const live = useQueries({
    queries: publicPolicies.map((p) => ({
      queryKey: ['public-rule', p.commitment],
      queryFn: () => getPublicRule(p.commitment),
    })),
  });
  const livePublic = publicPolicies.filter((_, i) => !!live[i]?.data?.rule);

  const addr = mode === 'paste' ? pasted.trim() : '';
  const validPaste = /^G[A-Z2-7]{55}$/.test(addr);
  // A key must be bounded by a cap and/or a rule (the vault rejects an unbounded key).
  const hasBound = !!ruleId || Number(cap) > 0;
  const canSubmit = hasBound && (mode === 'generate' || validPaste);

  const register = useMutation({
    mutationFn: async () => {
      const kp = mode === 'generate' ? Keypair.random() : null;
      const publicKey = mode === 'generate' ? kp!.publicKey() : addr;
      const capNum = cap ? Number(cap) : undefined;
      const expSecs = hours ? Math.round(Number(hours) * 3600) : undefined;
      await registerAgentKey(publicKey, ruleId || undefined, capNum, expSecs);
      return { publicKey, secret: kp?.secret() ?? null };
    },
    onSuccess: ({ publicKey, secret }) => {
      const next = [
        { publicKey, label: label.trim(), ruleId, createdAt: new Date().toISOString() },
        ...keys.filter((x) => x.publicKey !== publicKey),
      ];
      setKeys(next);
      saveKeys(next);
      qc.invalidateQueries({ queryKey: ['agent-key', publicKey] });
      setReveal(secret ? { kind: 'generated', publicKey, secret } : { kind: 'pasted', publicKey });
      setLabel('');
      setPasted('');
      setCap('');
      setHours('');
    },
  });

  if (isDemo()) return null;

  const forget = (publicKey: string) => {
    const next = keys.filter((x) => x.publicKey !== publicKey);
    setKeys(next);
    saveKeys(next);
  };

  return (
    <Card className="p-0">
      <CardHeader
        icon={KeyRound}
        title="Agent keys (self-custody)"
        hint="Authorize a key your agent holds, bounded by a cap and/or a public rule. Bring your own key (paste its address) or generate one here. One signature; then it spends hands-off (SDK/MCP local mode). Pause or revoke any time."
      />
      <div className="p-5 pt-4">
        {reveal ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-[12.5px] leading-relaxed text-slate-300">
              Agent key authorized on-chain. Provision your agent with the config below, then it
              spends within your rule hands-off. Pause or revoke it here any time.
            </div>
            {reveal.kind === 'generated' ? (
              <>
                <p className="text-[12px] text-slate-400">
                  Key generated in your browser and authorized on-chain. Save the secret now - it is
                  shown once and we do not keep it. Put it in your agent (local mode):
                </p>
                <CopyLine
                  label="Agent key address (public - already authorized)"
                  value={reveal.publicKey}
                />
                <CopyLine
                  label="CLEVERCON_SESSION_SECRET (secret - keep private, shown once)"
                  value={reveal.secret}
                />
                <p className="text-[11px] text-amber-300/80">
                  Anyone with this secret can spend within the rule/cap you set (and nothing else).
                  Store it as securely as a password.
                </p>
              </>
            ) : (
              <>
                <p className="text-[12px] text-slate-400">
                  This key is authorized on-chain. The dapp only ever saw its public address - never
                  the secret. Provision your agent (local mode) with{' '}
                  <span className="font-mono text-sky-300">CLEVERCON_SESSION_SECRET</span> = the
                  secret of the key you pasted (you hold it; we never do).
                </p>
                <CopyLine label="Authorized address" value={reveal.publicKey} />
              </>
            )}
            <div className="rounded-lg bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-slate-400">
              <div className="mb-1 font-medium text-slate-300">Agent config (local mode)</div>
              <span className="font-mono text-[11px] text-sky-300">
                CLEVERCON_PUBLIC_MODE=local
                <br />
                CLEVERCON_SESSION_SECRET=&lt;your key's secret&gt;
              </span>
              <div className="mt-1 text-slate-500">
                That is all - the vault + USDC ids default to the network, and the rule is bound
                on-chain.
              </div>
            </div>
            <div className="flex justify-end border-t border-white/[0.06] pt-3">
              <button onClick={() => setReveal(null)} className={primaryBtn}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 inline-flex rounded-lg bg-black/30 p-0.5 text-xs">
              {(['generate', 'paste'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 ${mode === m ? 'bg-sky-500/25 text-sky-200' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {m === 'generate' ? 'Generate a key' : 'Authorize an address'}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit && !register.isPending) register.mutate();
              }}
              className="space-y-3"
            >
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">
                  Label (for your reference)
                </span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Payout bot"
                  className={inputCls}
                />
              </label>

              {mode === 'paste' && (
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">Agent key address (G…)</span>
                  <input
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="G… (the public key of the wallet you made)"
                    className={inputCls + ' font-mono text-xs'}
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">
                  Public rule it runs under (optional if you set a cap)
                </span>
                <select
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value)}
                  className={inputCls}
                  aria-label="Public rule"
                >
                  <option value="">No rule - cap only</option>
                  {livePublic.map((p) => (
                    <option key={p.id} value={p.commitment}>
                      {p.name || `rule ${p.commitment.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">
                    Spend cap (USDC, optional)
                  </span>
                  <input
                    value={cap}
                    onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    placeholder="none"
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">
                    Expires in (hours, optional)
                  </span>
                  <input
                    value={hours}
                    onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder="open-ended"
                    className={inputCls}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={!canSubmit || register.isPending}
                className={primaryBtn + ' w-full'}
              >
                {register.isPending ? 'Authorizing…' : 'Authorize agent key'}
              </button>
              {register.error && <p className="text-sm text-red-400">{readErr(register.error)}</p>}
              <p className="text-[11px] text-slate-600">
                One wallet signature authorizes the key, bounded by your cap and/or rule. The vault
                enforces that (plus any expiry) on every spend; a global public rule, if set,
                applies on top. Set a cap or a rule - at least one.
              </p>
            </form>
          </>
        )}

        {keys.length > 0 && (
          <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              Your agent keys
            </div>
            {keys.map((k) => (
              <AgentKeyRow key={k.publicKey} k={k} onForget={() => forget(k.publicKey)} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
