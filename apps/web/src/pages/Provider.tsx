import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Briefcase, Star, Boxes, Plus } from 'lucide-react';
import {
  getProviderServices,
  getProviderEarnings,
  getProviderJobs,
  registerService,
  setServiceStatus,
} from '../lib/provider';
import { refreshRoles } from '../lib/sessionSync';
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  EmptyState,
  Loading,
  ErrorState,
  controls,
} from '../components/ui';

const JOB_STYLE: Record<string, string> = {
  CONFIRMED: 'text-emerald-300',
  COMPLETED: 'text-emerald-300',
  RELEASED: 'text-emerald-300',
  PENDING: 'text-amber-300',
  AWAITING_APPROVAL: 'text-amber-300',
  RUNNING: 'text-sky-300',
  SUBMITTED: 'text-sky-300',
  DISPUTED: 'text-red-300',
  FAILED: 'text-red-400',
  SKIPPED: 'text-slate-500',
};

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;
function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

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

  // Strict, field-level validation so a bad endpoint or payout address is caught
  // here rather than failing silently at hire time.
  const priceNum = Number(price);
  const endpointOk = endpoint.trim() === '' || isUrl(endpoint.trim());
  const addressOk = address.trim() === '' || STELLAR_ADDR.test(address.trim());
  const priceOk = price === '' || (Number.isFinite(priceNum) && priceNum >= 0);
  const canSubmit =
    !!name.trim() &&
    !!description.trim() &&
    isUrl(endpoint.trim()) &&
    STELLAR_ADDR.test(address.trim()) &&
    price !== '' &&
    Number.isFinite(priceNum) &&
    priceNum >= 0 &&
    !reg.isPending;

  const hint = (bad: boolean, msg: string) =>
    bad ? <p className="mt-1 text-xs text-red-400">{msg}</p> : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) reg.mutate();
      }}
      className="mt-4 space-y-3 rounded-xl bg-black/20 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Service name"
          className={controls.field}
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional)"
          className={controls.field}
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What it does"
        className={controls.field}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Price/call (USDC)"
            className={controls.field}
          />
          {hint(!priceOk, 'Enter a non-negative number.')}
        </div>
        <div className="sm:col-span-2">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://your-service.example.com/query"
            className={controls.field}
          />
          {hint(!endpointOk, 'Must be a valid http(s) URL.')}
        </div>
      </div>
      <div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Stellar payout address (G…)"
          className={`${controls.field} font-mono`}
        />
        {hint(!addressOk, 'Must be a valid Stellar public key (G… , 56 chars).')}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!canSubmit} className={controls.primary}>
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
  const qc = useQueryClient();
  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['provider-services'], queryFn: getProviderServices });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setServiceStatus(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-services'] });
      qc.invalidateQueries({ queryKey: ['services'] }); // the public marketplace
    },
  });
  return (
    <Card className="p-5">
      <CardHeader
        icon={Boxes}
        title="Your services"
        hint="Register endpoints agents can hire; pause one to remove it from the directory."
        action={
          <button onClick={() => setRegistering((v) => !v)} className={controls.chip}>
            {registering ? (
              'Close'
            ) : (
              <>
                <Plus size={14} /> Register
              </>
            )}
          </button>
        }
      />
      <div className="px-5 pb-5">
        {registering && <RegisterForm onDone={() => setRegistering(false)} />}
        <div className="mt-4">
          {isLoading ? (
            <Loading rows={2} />
          ) : error ? (
            <ErrorState>Could not load your services.</ErrorState>
          ) : services.length === 0 ? (
            <EmptyState>You have not registered any services yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {services.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.category ?? 'Uncategorised'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs">
                      <div className="text-slate-300">${s.pricePerCall}/call</div>
                      <div
                        className={`inline-flex items-center gap-1 ${
                          s.status === 'ACTIVE' ? 'text-emerald-300' : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            s.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />{' '}
                        {s.status}
                      </div>
                    </div>
                    <button
                      onClick={() => toggle.mutate({ id: s.id, active: s.status !== 'ACTIVE' })}
                      disabled={toggle.isPending}
                      className={`${controls.chip} shrink-0 disabled:opacity-50`}
                    >
                      {s.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function JobsCard() {
  const {
    data: jobs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider-jobs'],
    queryFn: getProviderJobs,
  });
  return (
    <Card className="p-5">
      <CardHeader
        icon={Briefcase}
        title="Incoming jobs"
        hint="Steps agents hired your services for."
      />
      <div className="px-5 pb-5 pt-4">
        {isLoading ? (
          <Loading rows={2} />
        ) : error ? (
          <ErrorState>Could not load jobs.</ErrorState>
        ) : jobs.length === 0 ? (
          <EmptyState>No jobs yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{j.action}</div>
                  <div className="truncate text-xs text-slate-500">
                    {j.service ?? 'service'} · {j.taskTitle} · {when(j.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-slate-300">${j.estimatedCost}</div>
                  <div className={`text-xs ${JOB_STYLE[j.status] ?? 'text-slate-400'}`}>
                    {j.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function Provider() {
  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Earn"
        title="Provider console"
        subtitle="Register services, handle jobs, and track earnings and reputation."
      />
      <Stats />

      <div className="grid gap-6 lg:grid-cols-2">
        <ServicesCard />
        <JobsCard />
      </div>
    </section>
  );
}
