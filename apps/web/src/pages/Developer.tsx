import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Activity, Webhook, Copy, Check } from 'lucide-react';
import { isDemo } from '../config';
import { demoUsage } from '../lib/demo';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
  type CreatedApiKey,
} from '../lib/apiKeys';
import { refreshRoles } from '../lib/sessionSync';

function when(v: string | null): string {
  if (!v) return 'never';
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toLocaleDateString();
}

function SecretReveal({ created }: { created: CreatedApiKey }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-xl border border-violet-500/40 bg-violet-500/10 p-4">
      <div className="text-sm font-medium text-violet-200">
        Copy your key now. It is shown only once.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-slate-200">
          {created.key}
        </code>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(created.key);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const {
    data: keys = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['apiKeys'], queryFn: getApiKeys });

  const createMut = useMutation({
    mutationFn: (n: string) => createApiKey(n),
    onSuccess: async (key) => {
      setCreated(key);
      setName('');
      await refreshRoles();
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apiKeys'] }),
  });

  const active = (k: ApiKey) => !k.revokedAt;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <KeyRound size={18} className="text-violet-300" />
        <h2 className="font-semibold">API keys</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMut.mutate(name.trim());
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. prod-agent)"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <button
          type="submit"
          disabled={!name.trim() || createMut.isPending}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMut.isPending ? 'Creating…' : 'Create key'}
        </button>
      </form>
      {createMut.error && <p className="mt-2 text-sm text-red-400">Could not create the key.</p>}
      {created && <SecretReveal created={created} />}

      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading keys…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load your keys.</p>}
      {!isLoading && !error && keys.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No keys yet. Create one to get API access.</p>
      )}
      <div className="mt-4 space-y-2">
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium">
                {k.name}
                {!active(k) && <span className="ml-2 text-xs text-red-300">revoked</span>}
              </div>
              <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-slate-500">
                <div>last used {when(k.lastUsedAt)}</div>
                <div>created {when(k.createdAt)}</div>
              </div>
              {active(k) && !isDemo() && (
                <button
                  onClick={() => revokeMut.mutate(k.id)}
                  disabled={revokeMut.isPending}
                  className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-red-500/20 hover:text-red-200"
                >
                  Revoke
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats() {
  const { data: keys = [] } = useQuery({ queryKey: ['apiKeys'], queryFn: getApiKeys });
  const activeKeys = keys.filter((k) => !k.revokedAt).length;
  const stats = isDemo()
    ? [
        { icon: Activity, label: 'Calls today', value: demoUsage.callsToday.toLocaleString() },
        { icon: Activity, label: 'Calls this week', value: demoUsage.callsWeek.toLocaleString() },
        { icon: KeyRound, label: 'Active keys', value: String(demoUsage.keys) },
      ]
    : [
        { icon: Activity, label: 'Calls today', value: 'n/a' },
        { icon: Activity, label: 'Calls this week', value: 'n/a' },
        { icon: KeyRound, label: 'Active keys', value: String(activeKeys) },
      ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <s.icon size={16} className="text-violet-300" />
          <div className="mt-2 text-xl font-bold">{s.value}</div>
          <div className="text-xs text-slate-500">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function Developer() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Developer portal</h1>
        <p className="mt-1 text-slate-400">API keys, usage, webhooks, and SDK/MCP docs.</p>
      </div>

      <Stats />
      <ApiKeys />

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center gap-2 text-slate-300">
          <Webhook size={18} className="text-violet-300" />
          <h2 className="font-semibold">Webhooks &amp; SDK</h2>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Subscribe to task and payment events, and embed spending in your own agent with the SDK
          and MCP server.
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <a
            href="https://github.com/clevercon-protocol/clevercon"
            className="text-violet-300 hover:text-violet-200"
          >
            SDK docs
          </a>
          <a
            href="https://github.com/clevercon-protocol/clevercon"
            className="text-violet-300 hover:text-violet-200"
          >
            MCP server
          </a>
        </div>
      </div>
    </section>
  );
}
