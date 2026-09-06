import { KeyRound, Activity, Webhook } from 'lucide-react';
import { demoUsage, demoApiKeys } from '../lib/demo';

const STAT = [
  { icon: Activity, label: 'Calls today', value: demoUsage.callsToday.toLocaleString() },
  { icon: Activity, label: 'Calls this week', value: demoUsage.callsWeek.toLocaleString() },
  { icon: KeyRound, label: 'Active keys', value: String(demoUsage.keys) },
];

export function Developer() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Developer portal</h1>
        <p className="mt-1 text-slate-400">API keys, usage, webhooks, and SDK/MCP docs.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {STAT.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <s.icon size={16} className="text-violet-300" />
            <div className="mt-2 text-xl font-bold">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <KeyRound size={18} className="text-violet-300" />
            <h2 className="font-semibold">API keys</h2>
          </div>
          <button
            disabled
            className="rounded-lg bg-white/10 px-3 py-1 text-sm text-slate-400 cursor-not-allowed"
          >
            Create key (demo)
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {demoApiKeys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div>
                <div className="font-medium">{k.name}</div>
                <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>last used {k.lastUsed}</div>
                <div>created {k.created}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

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
