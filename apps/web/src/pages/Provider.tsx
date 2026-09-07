import { useQuery } from '@tanstack/react-query';
import { DollarSign, Briefcase, Star, Boxes } from 'lucide-react';
import { getProviderServices, getProviderEarnings } from '../lib/provider';

const JOB_STYLE: Record<string, string> = {
  CONFIRMED: 'text-emerald-300',
  COMPLETED: 'text-emerald-300',
  PENDING: 'text-amber-300',
  SUBMITTED: 'text-sky-300',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
};

/** Shows an ISO timestamp as a short date, or passes demo strings through. */
function when(v: string): string {
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toLocaleDateString();
}

function Stats() {
  const { data, isLoading } = useQuery({
    queryKey: ['provider-earnings'],
    queryFn: getProviderEarnings,
  });
  const stats = [
    { icon: DollarSign, label: 'Total earned', value: `$${(data?.totalEarned ?? 0).toFixed(2)}` },
    { icon: DollarSign, label: 'This week', value: `$${(data?.thisWeek ?? 0).toFixed(2)}` },
    { icon: Briefcase, label: 'Jobs', value: String(data?.jobs ?? 0) },
    { icon: Star, label: 'Rating', value: (data?.rating ?? 0).toFixed(1) },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <s.icon size={16} className="text-violet-300" />
          <div className="mt-2 text-xl font-bold">{isLoading ? '…' : s.value}</div>
          <div className="text-xs text-slate-500">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function ServicesCard() {
  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['provider-services'], queryFn: getProviderServices });
  return (
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
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading services…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load your services.</p>}
      {!isLoading && !error && services.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">You have not registered any services yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {services.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3"
          >
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-slate-500">{s.category ?? 'Uncategorised'}</div>
            </div>
            <div className="text-right text-xs">
              <div className="text-slate-300">${s.pricePerCall}/call</div>
              <div className="inline-flex items-center gap-1 text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {s.status}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobsCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['provider-earnings'],
    queryFn: getProviderEarnings,
  });
  const jobs = data?.recent ?? [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Incoming jobs</h2>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading jobs…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load jobs.</p>}
      {!isLoading && !error && jobs.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No jobs yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {jobs.map((j) => (
          <div
            key={j.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{j.service}</div>
              <div className="text-xs text-slate-500">
                {j.from} · {when(j.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-300">${j.amount}</div>
              <div className={`text-xs ${JOB_STYLE[j.status] ?? 'text-slate-400'}`}>{j.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Provider() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Provider console</h1>
        <p className="mt-1 text-slate-400">
          Register services, handle jobs, and track earnings and reputation.
        </p>
      </div>

      <Stats />

      <div className="grid lg:grid-cols-2 gap-6">
        <ServicesCard />
        <JobsCard />
      </div>
    </section>
  );
}
