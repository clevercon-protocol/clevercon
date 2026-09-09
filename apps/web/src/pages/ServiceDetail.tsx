import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Star, Zap, Clock, Briefcase } from 'lucide-react';
import { getService } from '../lib/services';
import { createTask } from '../lib/tasks';

function HireBox({ serviceId, serviceName }: { serviceId: string; serviceName: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [budget, setBudget] = useState('');

  const hire = useMutation({
    mutationFn: () =>
      createTask({
        title: `Pay ${serviceName}`,
        mode: 'DIRECT',
        budget: Number(budget),
        serviceId,
      }),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/app/tasks/${task.id}`);
    },
  });

  const budgetNum = Number(budget);
  const canSubmit = budget !== '' && Number.isFinite(budgetNum) && budgetNum > 0 && !hire.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) hire.mutate();
      }}
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
    >
      <h2 className="font-semibold text-slate-300">Hire this service</h2>
      <p className="mt-1 text-sm text-slate-400">
        Creates a direct job you can track in your buyer console.
      </p>
      <input
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        inputMode="decimal"
        placeholder="Budget (USDC)"
        className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-3 w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {hire.isPending ? 'Creating…' : 'Hire now'}
      </button>
      {hire.error && <p className="mt-2 text-sm text-red-400">Could not create the job.</p>}
    </form>
  );
}

export function ServiceDetail() {
  const { id = '' } = useParams();
  const {
    data: service,
    isLoading,
    error,
  } = useQuery({ queryKey: ['service', id], queryFn: () => getService(id) });

  return (
    <section className="space-y-6">
      <Link
        to="/app/marketplace"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} /> Back to marketplace
      </Link>

      {isLoading && <p className="text-sm text-slate-500">Loading service…</p>}
      {error && <p className="text-sm text-red-400">Could not load this service.</p>}

      {service && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{service.name}</h1>
              <span className="inline-flex items-center gap-1 text-sm text-amber-300">
                <Star size={14} /> {service.rating.toFixed(1)}
              </span>
            </div>
            <p className="mt-1 text-slate-400">{service.description}</p>
            <p className="mt-1 text-sm text-slate-500">
              {service.category ?? 'Uncategorised'} · {service.provider}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Zap, label: 'Price / call', value: `$${service.pricePerCall}` },
              { icon: Briefcase, label: 'Jobs', value: String(service.totalJobs) },
              { icon: Star, label: 'Rating', value: service.rating.toFixed(1) },
              {
                icon: Clock,
                label: 'Avg latency',
                value: service.avgLatencyMs != null ? `${service.avgLatencyMs}ms` : 'n/a',
              },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <s.icon size={16} className="text-violet-300" />
                <div className="mt-2 text-xl font-bold">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="font-semibold text-slate-300">Capabilities</h2>
              {service.capabilities.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No capabilities listed.</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {service.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <dl className="mt-6 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Pricing</dt>
                  <dd className="text-slate-300">
                    {service.pricingModel} · {service.currency}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-slate-300">{service.status}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Endpoint</dt>
                  <dd className="truncate font-mono text-xs text-slate-400">{service.endpoint}</dd>
                </div>
              </dl>
            </div>

            <HireBox serviceId={service.id} serviceName={service.name} />
          </div>
        </>
      )}
    </section>
  );
}
