import { DollarSign, Briefcase, Star, Boxes } from 'lucide-react';
import { demoEarnings, demoServices, demoJobs, type DemoJob } from '../lib/demo';

const STAT = [
  { icon: DollarSign, label: 'Total earned', value: `$${demoEarnings.totalUsdc.toFixed(2)}` },
  { icon: DollarSign, label: 'This week', value: `$${demoEarnings.thisWeekUsdc.toFixed(2)}` },
  { icon: Briefcase, label: 'Jobs', value: String(demoEarnings.jobs) },
  { icon: Star, label: 'Rating', value: demoEarnings.rating.toFixed(1) },
];

const JOB_STYLE: Record<DemoJob['status'], string> = {
  completed: 'text-emerald-300',
  pending: 'text-amber-300',
  disputed: 'text-red-300',
};

export function Provider() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Provider console</h1>
        <p className="mt-1 text-slate-400">
          Register services, handle jobs, and track earnings and reputation.
        </p>
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

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              <Boxes size={18} className="text-violet-300" />
              <h2 className="font-semibold">Your services</h2>
            </div>
            <button
              disabled
              className="rounded-lg bg-white/10 px-3 py-1 text-sm text-slate-400 cursor-not-allowed"
            >
              Register (demo)
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {demoServices.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.category}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-slate-300">${s.pricePerCall}/call</div>
                  <div className="inline-flex items-center gap-1 text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="font-semibold text-slate-300">Incoming jobs</h2>
          <div className="mt-4 space-y-2">
            {demoJobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{j.service}</div>
                  <div className="text-xs text-slate-500">
                    {j.buyer} · {j.when}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-slate-300">${j.amountUsdc}</div>
                  <div className={`text-xs capitalize ${JOB_STYLE[j.status]}`}>{j.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
