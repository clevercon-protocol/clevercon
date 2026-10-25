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
  Globe,
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
        subtitle="API keys, usage, webhooks, and step-by-step SDK/MCP docs for both lanes."
      />
      <Stats />
      <ApiKeys />
      <CustodyMatrix />
      <PrivateLaneGuide />
      <PublicSelfGuide />
      <PublicServerGuide />
      <GlobalsGuide />
      <ErrorsReceiptsGuide />
      <WebhooksCard />

      <McpConnectCard />
    </section>
  );
}

// ── Shared doc primitives ─────────────────────────────────────────────────────
function GuideCard({
  icon: Icon,
  tint,
  title,
  subtitle,
  children,
}: {
  icon: typeof Lock;
  tint: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint}`}>
          <Icon size={17} />
        </span>
        <div>
          <h2 className="font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

const CC = (s: string) => <span className="font-mono text-[12px] text-violet-300">{s}</span>;

// ── Custody / mode matrix ─────────────────────────────────────────────────────
function CustodyMatrix() {
  const rows: {
    mode: string;
    custody: string;
    how: string;
    keys: string;
    tint: string;
    icon: typeof Lock;
  }[] = [
    {
      icon: Lock,
      tint: 'text-violet-300',
      mode: 'Private',
      custody: 'Self · keyless',
      how: 'Prove the rule locally (ZK); relay only the proof. No key, no delegate - the proof + your pinned commitment authorize the release.',
      keys: 'disbursePrivate() · disburse_private',
    },
    {
      icon: Eye,
      tint: 'text-sky-300',
      mode: 'Public',
      custody: 'Self · local key',
      how: 'Register a session key bounded by a cap and/or a named public rule; the agent holds the key and signs each release itself.',
      keys: 'registerSession() · createSessionSpender · session_pay',
    },
    {
      icon: Server,
      tint: 'text-emerald-300',
      mode: 'Public',
      custody: 'Platform · Managed Session',
      how: 'The owner authorizes a server-held key (cap + expiry) in the dapp; a headless agent spends hands-off via the API within that scope.',
      keys: 'sessionPay() · POST /vault/session/pay',
    },
  ];
  return (
    <GuideCard
      icon={ShieldCheck}
      tint="bg-white/[0.06] text-slate-200"
      title="Build on CleverCon: custody & mode"
      subtitle="Three ways an agent spends from a vault. Pick by who holds the key and whether the rule is private."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-4 font-medium">Mode</th>
              <th className="py-2 pr-4 font-medium">Custody</th>
              <th className="py-2 pr-4 font-medium">How it works</th>
              <th className="py-2 font-medium">Entry point</th>
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
                <td className="py-3 pr-4 text-slate-300">{r.custody}</td>
                <td className="py-3 pr-4 text-slate-400">{r.how}</td>
                <td className="py-3 font-mono text-[11.5px] text-slate-300">{r.keys}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        A global rule is optional in every path (one per lane). Private is the default and the only
        lane where the rule stays secret; the public lane trades that for hands-off speed, so its
        rule is on-chain in the clear.
      </p>
    </GuideCard>
  );
}

// ── Private lane (self, keyless) ──────────────────────────────────────────────
function PrivateLaneGuide() {
  const install = 'npm i @clevercon/agent-sdk';
  const env = [
    'CLEVERCON_API_KEY=cc_yourprefix.yoursecret',
    '# the { rules, salt } bundle you copied from the Rules tab (never touches our server):',
    'CLEVERCON_POLICY_JSON={"rules":{...},"salt":"..."}',
    '# circuit artifacts (download once):',
    'CLEVERCON_PP2_WASM=/path/policy_batch.wasm',
    'CLEVERCON_PP2_ZKEY=/path/policy_batch_final.zkey',
  ].join('\n');
  const code = [
    "import { createSpender } from '@clevercon/agent-sdk';",
    '',
    'const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });',
    '',
    '// Proves your private rule locally and relays ONLY the proof (keyless).',
    'const { txHash, totalUsdc } = await cc.disbursePrivate([',
    "  { payee: 'G...A', amount: 2 },",
    "  { payee: 'G...B', amount: 3 },",
    ']);',
  ].join('\n');
  return (
    <GuideCard
      icon={Lock}
      tint="bg-violet-500/10 text-violet-300"
      title="Private lane · self-custody, keyless"
      subtitle="The rule never leaves your device. The agent proves it locally; the vault verifies the proof on-chain."
    >
      <Steps
        items={[
          <>
            In the dapp, open <b>Rules</b>, create a <b>Private</b> rule, and <b>Pin</b> it on-chain
            (one wallet signature).
          </>,
          <>
            Use the key icon on the card to reveal the {CC('{ rules, salt }')} bundle, and copy it.
            The salt is the only secret; it is never sent to our server.
          </>,
          <>Install the SDK and provision the bundle + circuit artifacts as env (below).</>,
          <>
            Call {CC('disbursePrivate(lines)')} (up to 4 payees per proof). It returns the on-chain
            tx hash; no delegate and no per-payment signature.
          </>,
        ]}
      />
      <CopyBlock text={install} label="install" />
      <CopyBlock text={env} label="private env" />
      <CopyBlock text={code} label="private snippet" />
      <p className="text-xs text-slate-500">
        MCP: provision the same {CC('CLEVERCON_POLICY_JSON')} + artifacts and call the{' '}
        {CC('disburse_private')} tool. A global-private rule? See Globals below.
      </p>
    </GuideCard>
  );
}

// ── Public lane (self, local key under a rule) ────────────────────────────────
function PublicSelfGuide() {
  const code = [
    "import { registerSession, createSessionSpender } from '@clevercon/agent-sdk/sessions';",
    '',
    'const net = { vaultId: process.env.CLEVERCON_VAULT_ID!, usdcSac: process.env.CLEVERCON_USDC_SAC! };',
    '',
    '// Owner authorizes ONCE (wallet secret signs). Bound by a cap AND/OR a public rule id.',
    'const session = await registerSession({',
    '  ...net,',
    '  ownerSecret: process.env.OWNER_SECRET!,',
    '  spendCapUsdc: 50,',
    "  ruleId: 'the64hexPublicRuleId', // from the Rules tab (optional if a cap is set)",
    '  // expiresInSeconds: omit for an open-ended local key',
    '});',
    '',
    '// Hand session.sessionSecret to the agent; it spends with ONLY that key:',
    'const spender = createSessionSpender({ ...net, sessionSecret: session.sessionSecret });',
    "await spender.pay('G...', 5);",
  ].join('\n');
  return (
    <GuideCard
      icon={Eye}
      tint="bg-sky-500/10 text-sky-300"
      title="Public lane · self-custody, local session key"
      subtitle="The agent holds its own session key, bounded on-chain by a cap and/or a named public rule."
    >
      <Steps
        items={[
          <>
            In the dapp, open <b>Rules</b>, create a <b>Public</b> rule (its clauses go on-chain in
            the clear), and copy its <b>rule id</b> from the key icon.
          </>,
          <>
            Call {CC('registerSession')} with the owner wallet secret, a {CC('spendCapUsdc')} and/or
            that {CC('ruleId')} (at least one). The owner signs once.
          </>,
          <>
            Hand the returned {CC('sessionSecret')} to the agent (via env{' '}
            {CC('CLEVERCON_SESSION_SECRET')}), never to the model.
          </>,
          <>
            The agent pays with {CC('createSessionSpender(...).pay()')} (MCP: the{' '}
            {CC('session_pay')} tool). Pause / revoke any time from the dapp or{' '}
            {CC('setSessionPaused')} / {CC('revokeSession')}.
          </>,
        ]}
      />
      <CopyBlock text={code} label="public self snippet" />
    </GuideCard>
  );
}

// ── Public lane (platform-held Managed Session) ───────────────────────────────
function PublicServerGuide() {
  const code = [
    "import { createSpender } from '@clevercon/agent-sdk';",
    '',
    'const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });',
    '',
    '// The owner enabled a Managed Session (cap + expiry) in the dapp Vault tab.',
    '// A headless agent spends hands-off within it - the platform signs, you never do:',
    "await cc.sessionPay('G...', 5);",
    'const session = await cc.getSession(); // cap / spent / remaining / expiry / paused',
  ].join('\n');
  return (
    <GuideCard
      icon={Server}
      tint="bg-emerald-500/10 text-emerald-300"
      title="Public lane · platform-held Managed Session"
      subtitle="The simplest hands-off path: the owner sets a cap + expiry once; a headless agent spends via the API."
    >
      <Steps
        items={[
          <>
            In the dapp, open <b>Vault</b> and enable a <b>Managed Session</b>: a total spend cap
            and an expiry (one wallet signature). Pause, extend, or revoke it there any time.
          </>,
          <>
            Optionally mark a public rule <b>global</b> on the Rules tab; the vault AND-enforces it
            on every session spend on top of the cap.
          </>,
          <>
            The agent (authenticated with your API key) calls {CC('cc.sessionPay(payee, amount)')} -
            no key handling, no per-payment signature. The vault enforces the cap, expiry, and any
            global rule.
          </>,
        ]}
      />
      <CopyBlock text={code} label="public server snippet" />
    </GuideCard>
  );
}

// ── Globals ───────────────────────────────────────────────────────────────────
function GlobalsGuide() {
  const env = [
    '# When a GLOBAL-PRIVATE rule is set, provision its bundle too (the "global salt"):',
    'CLEVERCON_GLOBAL_POLICY_JSON={"rules":{...},"salt":"..."}',
  ].join('\n');
  return (
    <GuideCard
      icon={Globe}
      tint="bg-fuchsia-500/10 text-fuchsia-300"
      title="Global rules"
      subtitle="A global is optional and AND-applied to every spend in its lane, on top of the rule you use."
    >
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
        <li>
          <b>Global-private</b>: mark a pinned private rule global in the dapp. The vault then
          requires a SECOND proof per spend. Provision the global bundle to the agent as{' '}
          {CC('CLEVERCON_GLOBAL_POLICY_JSON')} (SDK: {CC('globalBundle')}); {CC('disbursePrivate')}{' '}
          / {CC('disburse_private')} build and relay the second proof automatically.
        </li>
        <li>
          <b>Global-public</b>: mark a public rule global in the dapp. The vault AND-enforces its
          cleartext clauses on every session spend. Nothing to provision - it is checked server-side
          from the rule id, so {CC('sessionPay')} / local-key spends just work within it.
        </li>
      </ul>
      <CopyBlock text={env} label="global env" />
    </GuideCard>
  );
}

// ── Errors & receipts ─────────────────────────────────────────────────────────
function ErrorsReceiptsGuide() {
  const err = [
    '// Every vault call returns a clean, actionable message (never a raw HostError):',
    '{ "statusCode": 400, "message": "This payment would exceed the rule\\u2019s rolling cap for its window." }',
    '',
    '// In the SDK, failures throw CleverConError { status, message }:',
    'try { await cc.disbursePrivate(lines); }',
    'catch (e) { if (e instanceof CleverConError) console.error(e.status, e.message); }',
  ].join('\n');
  const rec = [
    'const activity = await cc.getActivity(); // jobs + payments, newest first (incl. keyless releases)',
  ].join('\n');
  return (
    <GuideCard
      icon={Activity}
      tint="bg-white/[0.06] text-slate-200"
      title="Errors & receipts"
      subtitle="Rejections come back as plain sentences; activity gives you a verifiable ledger."
    >
      <p className="text-sm text-slate-400">
        The vault, API, and SDK translate contract errors into specific messages (cap exceeded,
        payee denied, below minimum, outside the calendar window, session paused/expired, and so
        on), so a failed spend never surfaces as gibberish. The SDK raises {CC('CleverConError')}{' '}
        with the HTTP status.
      </p>
      <CopyBlock text={err} label="error shape" />
      <CopyBlock text={rec} label="receipts" />
    </GuideCard>
  );
}

/** The two-minute MCP quickstart: paste a config, restart, your agent can spend. */
function McpConnectCard() {
  const cfg = mcpServerConfig(config.apiUrl, 'cc_yourprefix.yoursecret');
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Terminal size={18} className="text-violet-300" />
        <h2 className="font-semibold">Connect an agent over MCP</h2>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Give any MCP-capable agent (Claude Desktop, Cursor, your own) a bounded, non-custodial
        spending account. It can search the directory, hire a service, and track the task, always
        within your policy.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-400">
        <li>Create an API key above and copy it into CLEVERCON_API_KEY.</li>
        <li>
          Paste this into your MCP client config (Claude Desktop: Settings, Developer, Edit Config).
        </li>
        <li>Restart the client. The clevercon tools appear and spend on the rail.</li>
      </ol>
      <div className="mt-3">
        <CopyBlock text={cfg} label="MCP config" />
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Running from source before the npm publish? Set command to node and point args at the built
        packages/mcp/dist/server.js path. Full SDK and MCP docs:{' '}
        <a
          href="https://github.com/clevercon-protocol/clevercon/tree/main/packages/mcp"
          className="text-violet-300 hover:text-violet-200"
        >
          packages/mcp
        </a>
        .
      </p>
    </div>
  );
}
