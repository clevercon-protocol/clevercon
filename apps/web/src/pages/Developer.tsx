import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Activity,
  Webhook,
  Copy,
  Check,
  Terminal,
  Lock,
  Eye,
  Server,
  ShieldCheck,
} from 'lucide-react';
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
      <McpQuickstart />
      <McpToolbox />
      <CustodyReference />
      <WebhooksCard />
    </section>
  );
}

// ── MCP quickstart (the primary integration path) ─────────────────────────────

/** The extra env a given lane needs, plus the MCP tool(s) it unlocks. */
const PRIVATE_ENV = [
  '# Private (keyless): the ONE policy key you copied from the Rules tab.',
  '# It packs your rule + its salt; it never leaves the agent, only the proof is relayed.',
  'CLEVERCON_POLICY_KEY=ccpk1_…',
  '# Only if a private rule is marked GLOBAL on your account, add its key too:',
  '# CLEVERCON_GLOBAL_KEY=ccpk1_…',
  '# (Circuit artifacts download automatically on first use - nothing to set.)',
].join('\n');

const PUBLIC_SERVER_ENV = [
  '# Public, SERVER mode: spend via the account Managed Session (set up in the dapp,',
  '# bound to a public rule there). No rule in the config - the bound rule governs.',
  'CLEVERCON_PUBLIC_MODE=server',
  '# (A global public rule, if set, applies automatically too.)',
].join('\n');

const PUBLIC_LOCAL_ENV = [
  '# Public, LOCAL mode (default): the agent holds its own session key.',
  '# Authorize the key on the dapp (Vault -> Agent keys), bound to a public rule.',
  '# The dapp gives you this ONE token (secret + vault); the bound rule governs.',
  'CLEVERCON_PUBLIC_MODE=local',
  'CLEVERCON_SESSION_KEY=ccsk1_…',
].join('\n');

function LaneTab({
  active,
  onClick,
  icon: Icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Lock;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-violet-500/50 bg-violet-500/[0.08]'
          : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      <Icon size={16} className={active ? 'mt-0.5 text-violet-300' : 'mt-0.5 text-slate-500'} />
      <span>
        <span className={`block text-sm font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function ToolPill({ name }: { name: string }) {
  return (
    <span className="rounded-md bg-violet-500/10 px-2 py-0.5 font-mono text-[11.5px] text-violet-200">
      {name}
    </span>
  );
}

/**
 * The hero: connect an MCP agent, then pick the one lane it spends in. Each lane
 * shows the exact env to add and the MCP tool it unlocks. MCP-first; the SDK is a
 * compact reference below for non-MCP agents.
 */
function McpQuickstart() {
  const [lane, setLane] = useState<'private' | 'public'>('private');
  const cfg = mcpServerConfig(config.apiUrl, 'cc_yourprefix.yoursecret');
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
          <Terminal size={17} />
        </span>
        <div>
          <h2 className="font-semibold text-white">Connect an agent over MCP</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Give any MCP-capable agent (Claude Desktop, Cursor, your own) a bounded, non-custodial
            spending account in two minutes.
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
        <div className="text-sm font-medium text-slate-200">Then pick how it spends</div>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          One extra block of env, and your agent can pay. Choose the lane, add the env to the same
          config, restart.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <LaneTab
            active={lane === 'private'}
            onClick={() => setLane('private')}
            icon={Lock}
            label="Private · keyless"
            sub="The rule stays secret; proven locally per payment."
          />
          <LaneTab
            active={lane === 'public'}
            onClick={() => setLane('public')}
            icon={Eye}
            label="Public · session key"
            sub="A bounded key; instant, no per-payment proof."
          />
        </div>

        {lane === 'private' ? (
          <div className="mt-4 space-y-3">
            <p className="text-[12.5px] leading-relaxed text-slate-400">
              In the dapp, create a <b>Private</b> rule, <b>Pin</b> it, then copy its single{' '}
              <span className="font-mono text-[11.5px] text-violet-300">policy key</span> (it packs
              the rule + salt; nothing else to set). Add it to the config env:
            </p>
            <CopyBlock text={PRIVATE_ENV} label="private env" />
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-400">
              Tool: <ToolPill name="disburse_private" /> pays up to 4 payees in one keyless proof.
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-[12.5px] leading-relaxed text-slate-400">
              Public spending uses a session key in one of two modes. The rule it runs under is
              bound to the key on the dapp, so the agent config carries no rule (a global, if any,
              applies automatically).
            </p>
            <div className="text-[12px] font-medium text-slate-300">
              Local (default) &ndash; the agent holds its own key:
            </div>
            <CopyBlock text={PUBLIC_LOCAL_ENV} label="public local env" />
            <div className="text-[12px] font-medium text-slate-300">
              Server &ndash; use the account Managed Session (set up in the dapp Vault tab):
            </div>
            <CopyBlock text={PUBLIC_SERVER_ENV} label="public server env" />
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-400">
              Tools: <ToolPill name="session_pay" /> <ToolPill name="session_scope" /> pay within
              the scope, instantly.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Friendly tool reference ───────────────────────────────────────────────────
function McpToolbox() {
  const groups: { label: string; tools: string[] }[] = [
    { label: 'Spend', tools: ['disburse_private', 'session_pay'] },
    { label: 'Check', tools: ['session_scope', 'get_budget', 'get_activity'] },
    { label: 'Rules', tools: ['set_limit', 'list_limits'] },
    {
      label: 'Marketplace',
      tools: [
        'search_services',
        'get_service',
        'hire_agent',
        'list_tasks',
        'get_task',
        'approve_task',
        'dispute_task',
      ],
    },
  ];
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-slate-200">
          <KeyRound size={17} />
        </span>
        <div>
          <h2 className="font-semibold text-white">What your agent can do</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            The tools your agent gets over MCP. Every spend is bounded on-chain by your vault.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.label} className="rounded-xl bg-black/20 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              {g.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.tools.map((t) => (
                <ToolPill key={t} name={t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Compact custody reference + SDK fallback ──────────────────────────────────
function CustodyReference() {
  const [open, setOpen] = useState(false);
  const rows: { icon: typeof Lock; tint: string; mode: string; who: string; via: string }[] = [
    {
      icon: Lock,
      tint: 'text-violet-300',
      mode: 'Private',
      who: 'Agent (keyless)',
      via: 'disburse_private · SDK disbursePrivate',
    },
    {
      icon: Eye,
      tint: 'text-sky-300',
      mode: 'Public',
      who: 'Agent (session key)',
      via: 'session_pay · SDK createSessionSpender',
    },
    {
      icon: Server,
      tint: 'text-emerald-300',
      mode: 'Public',
      who: 'Platform (Managed Session)',
      via: 'dapp Vault tab · SDK sessionPay',
    },
  ];
  const sdk = [
    "import { createSpender } from '@clevercon/agent-sdk';",
    'const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });',
    '',
    '// Private, keyless (CLEVERCON_POLICY_KEY via env; artifacts auto-download):',
    'await cc.disbursePrivate([{ payee: "G...", amount: 5 }]);',
    '',
    '// Public, platform-held Managed Session (owner enabled it in the dapp):',
    'await cc.sessionPay("G...", 5);',
  ].join('\n');
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-slate-200">
          <ShieldCheck size={17} />
        </span>
        <div>
          <h2 className="font-semibold text-white">Custody &amp; modes</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Who holds the key in each lane. A global rule is optional (one per lane), AND-applied on
            top of whatever rule you use.
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-4 font-medium">Mode</th>
              <th className="py-2 pr-4 font-medium">Key holder</th>
              <th className="py-2 font-medium">How</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/[0.06]">
                <td className="py-3 pr-4">
                  <span className={`inline-flex items-center gap-1.5 font-medium ${r.tint}`}>
                    <r.icon size={14} /> {r.mode}
                  </span>
                </td>
                <td className="py-3 pr-4 text-slate-300">{r.who}</td>
                <td className="py-3 font-mono text-[11.5px] text-slate-400">{r.via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-[12.5px] font-medium text-violet-300 hover:text-violet-200"
      >
        {open ? 'Hide' : 'Prefer code? Use the SDK instead of MCP'}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <CopyBlock text={'npm i @clevercon/agent-sdk'} label="install" />
          <CopyBlock text={sdk} label="sdk snippet" />
          <p className="text-[11.5px] text-slate-500">
            Errors come back as plain sentences (cap exceeded, payee denied, session paused, outside
            the date window, …) and the SDK raises CleverConError{'{ status, message }'}. Read the
            ledger with cc.getActivity().
          </p>
        </div>
      )}
    </div>
  );
}
