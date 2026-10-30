import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Activity, Webhook, Copy, Check, Terminal, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isDemo, config } from '../config';
import { demoUsage } from '../lib/demo';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
  type CreatedApiKey,
} from '../lib/apiKeys';
import {
  getWebhooks,
  createWebhook,
  deleteWebhook,
  WEBHOOK_EVENTS,
  type Webhook as WebhookRow,
  type CreatedWebhook,
} from '../lib/webhooks';
import { refreshRoles } from '../lib/sessionSync';
import { PageHeader, StatCard, Loading, ErrorState, controls } from '../components/ui';

function WebhooksCard() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const { data: hooks = [] } = useQuery({ queryKey: ['webhooks'], queryFn: getWebhooks });
  const add = useMutation({
    mutationFn: () => createWebhook(url.trim(), [...WEBHOOK_EVENTS]),
    onSuccess: (w) => {
      setUrl('');
      setCreated(w);
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Webhook size={18} className="text-violet-300" />
        <h2 className="font-semibold">Webhooks</h2>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Get a signed POST (HMAC-SHA256 in x-clevercon-signature) when your tasks complete or fail.
      </p>
      {isDemo() ? (
        <p className="mt-3 text-sm text-slate-500">Connect in full mode to register webhooks.</p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim() && !add.isPending) add.mutate();
            }}
            className="mt-4 flex flex-wrap gap-2"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.example.com/webhooks/clevercon"
              className={`min-w-64 flex-1 ${controls.field}`}
            />
            <button
              type="submit"
              disabled={!url.trim() || add.isPending}
              className={controls.primary}
            >
              {add.isPending ? 'Adding…' : 'Add webhook'}
            </button>
          </form>
          {created && (
            <div className="mt-3 rounded-xl border border-violet-500/40 bg-violet-500/10 p-3 text-xs">
              <div className="text-slate-300">Signing secret (shown once):</div>
              <div className="mt-1 break-all font-mono text-violet-200">{created.secret}</div>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {hooks.map((h: WebhookRow) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-slate-300">{h.url}</div>
                  <div className="text-xs text-slate-500">
                    {h.events.length ? h.events.join(', ') : 'all events'}
                  </div>
                </div>
                <button
                  onClick={() => del.mutate(h.id)}
                  disabled={del.isPending}
                  className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-400 hover:bg-white/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function when(v: string | null): string {
  if (!v) return 'never';
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toLocaleDateString();
}

/** The ready-to-paste MCP client config that points an agent at this rail. */
function mcpServerConfig(apiUrl: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        clevercon: {
          command: 'npx',
          args: ['-y', '@clevercon/mcp'],
          env: { CLEVERCON_API_URL: apiUrl, CLEVERCON_API_KEY: apiKey },
        },
      },
    },
    null,
    2,
  );
}

/** A code block with a copy button, for configs and snippets. */
function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-slate-200">
        <code>{text}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
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
      <div className="mt-3">
        <div className="text-xs text-slate-300">
          Connect your agent: paste this into your MCP client config, then restart it.
        </div>
        <div className="mt-1">
          <CopyBlock text={mcpServerConfig(config.apiUrl, created.key)} label="MCP config" />
        </div>
      </div>
    </div>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [quota, setQuota] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const {
    data: keys = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['apiKeys'], queryFn: getApiKeys });

  const createMut = useMutation({
    mutationFn: (args: { name: string; quotaPerDay: number }) =>
      createApiKey(args.name, args.quotaPerDay),
    onSuccess: async (key) => {
      setCreated(key);
      setName('');
      setQuota('');
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
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <KeyRound size={18} className="text-violet-300" />
        <h2 className="font-semibold">API keys</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            const q = Math.max(0, Math.trunc(Number(quota) || 0));
            createMut.mutate({ name: name.trim(), quotaPerDay: q });
          }
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. prod-agent)"
          className="flex-1 rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <input
          value={quota}
          onChange={(e) => setQuota(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          placeholder="Daily cap (0 = unlimited)"
          title="Maximum calls per UTC day. Leave blank or 0 for unlimited."
          className="w-44 rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
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

      {isLoading && (
        <div className="mt-4">
          <Loading rows={2} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState>Could not load your keys.</ErrorState>
        </div>
      )}
      {!isLoading && !error && keys.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No keys yet. Create one to get API access.</p>
      )}
      <div className="mt-4 space-y-2">
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between rounded-xl bg-white/[0.04] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium">
                {k.name}
                {!active(k) && <span className="ml-2 text-xs text-red-300">revoked</span>}
              </div>
              <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
              <div className="mt-1 text-xs text-slate-500">
                {k.quotaPerDay > 0 ? (
                  <span className={k.usageToday >= k.quotaPerDay ? 'text-amber-300' : ''}>
                    {k.usageToday}/{k.quotaPerDay} today
                  </span>
                ) : (
                  <span>unlimited</span>
                )}
                <span className="text-slate-600"> · {k.requestCount} total</span>
              </div>
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
  const totalCalls = keys.reduce((sum, k) => sum + (k.requestCount ?? 0), 0);
  const stats = isDemo()
    ? [
        { icon: Activity, label: 'Calls today', value: demoUsage.callsToday.toLocaleString() },
        { icon: Activity, label: 'Calls this week', value: demoUsage.callsWeek.toLocaleString() },
        { icon: KeyRound, label: 'Active keys', value: String(demoUsage.keys) },
      ]
    : [
        { icon: Activity, label: 'Total calls', value: totalCalls.toLocaleString() },
        { icon: KeyRound, label: 'Active keys', value: String(activeKeys) },
        { icon: KeyRound, label: 'All keys', value: String(keys.length) },
      ];
  const accents = ['sky', 'violet', 'emerald'];
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((s, i) => (
        <StatCard key={s.label} icon={s.icon} accent={accents[i]} label={s.label} value={s.value} />
      ))}
    </div>
  );
}

export function Developer() {
  return (
    <section className="space-y-6">
      <PageHeader
        title="Developer portal"
        subtitle="Connect an agent over MCP in two minutes, manage API keys, and wire webhooks."
      />
      <Stats />
      <ApiKeys />
      <ConnectAgent />
      <WebhooksCard />
    </section>
  );
}
// ── Connect an agent (summary + links to the full docs) ───────────────────────

const DOC_LINKS = [
  {
    to: '/docs/developer-quickstart',
    title: 'Developer quickstart',
    desc: 'Connect over MCP or embed the SDK, with the two spend lanes.',
  },
  { to: '/docs/mcp', title: 'MCP server', desc: 'Every tool, the config env, and both lanes.' },
  { to: '/docs/sdk', title: 'SDK', desc: 'createSpender, sessions, receipts, and providers.' },
  {
    to: '/docs/config-keys',
    title: 'Config keys',
    desc: 'Policy key, session key, rule key, and API key.',
  },
];

/**
 * The integration starting point: create a key, paste the MCP config, and go. The
 * detailed setup (choosing a lane, the policy/session keys, every tool, the SDK)
 * lives in the docs, which this card links to rather than duplicating.
 */
function ConnectAgent() {
  const cfg = mcpServerConfig(config.apiUrl, 'cc_yourprefix.yoursecret');
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
          <Terminal size={17} />
        </span>
        <div>
          <h2 className="font-semibold text-white">Connect an agent</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Give any MCP-capable agent (Claude Desktop, Cursor, your own) a bounded, non-custodial
            spending account. Create a key above, paste the config, and your agent spends within
            your limits.
          </p>
        </div>
      </div>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-300">
        <li>Create an API key above and copy it into CLEVERCON_API_KEY.</li>
        <li>
          Paste this into your MCP client config (Claude Desktop: Settings, Developer, Edit Config).
        </li>
        <li>Restart the client. The clevercon tools appear and spend on the rail.</li>
      </ol>
      <div className="mt-3">
        <CopyBlock text={cfg} label="MCP config" />
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="text-sm font-medium text-slate-200">Full setup and reference</div>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          Choosing a spend lane (private keyless, or a public session key), the policy and session
          keys, every MCP tool, and the SDK all live in the docs.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {DOC_LINKS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 transition-colors hover:border-violet-500/40 hover:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{d.title}</span>
                <ArrowRight
                  size={14}
                  className="text-slate-500 transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{d.desc}</p>
            </Link>
          ))}
        </div>
        <Link
          to="/docs/developer-quickstart"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-violet-300 hover:text-violet-200"
        >
          Open the developer docs <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
