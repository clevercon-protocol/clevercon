import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Briefcase, Star, Boxes } from 'lucide-react';
import { getProviderServices, getProviderEarnings, registerService } from '../lib/provider';
import { refreshRoles } from '../lib/sessionSync';
import { PageHeader, StatCard } from '../components/ui';

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
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={DollarSign}
        accent="emerald"
        label="Total earned"
        loading={isLoading}
        value={`$${(data?.totalEarned ?? 0).toFixed(2)}`}
      />
      <StatCard
        icon={DollarSign}
        accent="violet"
        label="This week"
        loading={isLoading}
        value={`$${(data?.thisWeek ?? 0).toFixed(2)}`}
      />
      <StatCard
        icon={Briefcase}
        accent="sky"
        label="Jobs"
        loading={isLoading}
        value={String(data?.jobs ?? 0)}
      />
      <StatCard
        icon={Star}
        accent="amber"
        label="Rating"
        loading={isLoading}
        value={(data?.rating ?? 0).toFixed(1)}
      />
    </div>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [address, setAddress] = useState('');

  const reg = useMutation({
    mutationFn: () =>
      registerService({
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        pricingModel: 'X402',
        pricePerCall: Number(price),
        endpoint: endpoint.trim(),
        stellarAddress: address.trim(),
      }),
    onSuccess: async () => {
      await refreshRoles();
      qc.invalidateQueries({ queryKey: ['provider-services'] });
      qc.invalidateQueries({ queryKey: ['services'] });
      onDone();
    },
  });

  const priceNum = Number(price);
  const canSubmit =
    name.trim() &&
    description.trim() &&
    endpoint.trim() &&
    address.trim() &&
    price !== '' &&
    Number.isFinite(priceNum) &&
    priceNum >= 0 &&
    !reg.isPending;

  const field =
    'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) reg.mutate();
      }}
      className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4"
    >
      <div className="grid sm:grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Service name"
          className={field}
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional)"
          className={field}
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What it does"
        className={field}
      />
      <div className="grid sm:grid-cols-3 gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="Price/call (USDC)"
          className={field}
        />
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://endpoint"
          className={`sm:col-span-2 ${field}`}
        />
      </div>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Stellar payout address (G…)"
        className={field}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reg.isPending ? 'Registering…' : 'Register service'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-slate-400 hover:text-white">
          Cancel
        </button>
        {reg.error && <span className="text-sm text-red-400">Could not register.</span>}
      </div>
    </form>
  );
}

function ServicesCard() {
  const [registering, setRegistering] = useState(false);
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
          onClick={() => setRegistering((v) => !v)}
          className="rounded-lg bg-white/10 px-3 py-1 text-sm text-slate-200 hover:bg-white/20"
        >
          {registering ? 'Close' : 'Register'}
        </button>
      </div>
      {registering && <RegisterForm onDone={() => setRegistering(false)} />}
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
      <PageHeader
        title="Provider console"
        subtitle="Register services, handle jobs, and track earnings and reputation."
      />
      <Stats />

      <div className="grid lg:grid-cols-2 gap-6">
        <ServicesCard />
        <JobsCard />
      </div>
    </section>
  );
}
