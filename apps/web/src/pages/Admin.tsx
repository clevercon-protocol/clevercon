import { Users, Boxes, Percent, Landmark } from 'lucide-react';
import { demoPlatform, demoDisputes } from '../lib/demo';

const STAT = [
  { icon: Users, label: 'Users', value: String(demoPlatform.users) },
  { icon: Boxes, label: 'Active services', value: String(demoPlatform.activeServices) },
  { icon: Percent, label: 'Protocol fee', value: `${(demoPlatform.feeBps / 100).toFixed(2)}%` },
  { icon: Landmark, label: 'Value locked', value: `$${demoPlatform.tvlUsdc.toLocaleString()}` },
];

export function Admin() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin console</h1>
        <p className="mt-1 text-slate-400">Disputes, fees, users, and platform monitoring.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <s.icon size={16} className="text-violet-300" />
            <div className="mt-2 text-xl font-bold">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-semibold text-slate-300">Disputes</h2>
        <div className="mt-4 space-y-2">
          {demoDisputes.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div>
                <div className="font-medium">{d.task}</div>
                <div className="text-xs text-slate-500">{d.parties}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-300">${d.amountUsdc}</span>
                <span
                  className={`text-xs capitalize ${d.status === 'open' ? 'text-amber-300' : 'text-emerald-300'}`}
                >
                  {d.status}
                </span>
                <button
                  disabled
                  className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-slate-400 cursor-not-allowed"
                >
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
