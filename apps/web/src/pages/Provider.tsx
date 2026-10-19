import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Briefcase, Star, Boxes, Plus, Flag } from 'lucide-react';
import {
  getProviderServices,
  getProviderEarnings,
  getProviderJobs,
  getProviderDisputes,
  respondToDispute,
  registerService,
  setServiceStatus,
  type RegisterServiceInput,
} from '../lib/provider';
import { getPlatformFeeBps } from '../lib/services';
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
  const { data: feeBps = 0 } = useQuery({ queryKey: ['platform-fee'], queryFn: getPlatformFeeBps });
  return (
    <>
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
      {feeBps > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Earnings are net of a {(feeBps / 100).toFixed(2)}% protocol fee deducted on each payout.
        </p>
      )}
    </>
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
  const [pricingModel, setPricingModel] = useState<'X402' | 'MPP'>('X402');
  // Acceptance contract: how delivery is judged before you are paid.
  const [tier, setTier] = useState<'T1' | 'T2' | 'T3'>('T2');
  const [vmethod, setVmethod] = useState<string>('onchain');
  const [specJson, setSpecJson] = useState('');
  const [inJson, setInJson] = useState('');
  const [outJson, setOutJson] = useState('');
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  const reg = useMutation({
    mutationFn: (input: RegisterServiceInput) => registerService(input),
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

  // Build the full registration input, parsing the optional acceptance-contract
  // JSON. Returns null (and sets an error) if any JSON is malformed.
  const buildInput = (): RegisterServiceInput | null => {
    let spec: Record<string, unknown> | undefined;
    let inputSchema: Record<string, unknown> | undefined;
    let outputSchema: Record<string, unknown> | undefined;
    try {
      spec = specJson.trim() ? JSON.parse(specJson) : undefined;
      inputSchema = inJson.trim() ? JSON.parse(inJson) : undefined;
      outputSchema = outJson.trim() ? JSON.parse(outJson) : undefined;
    } catch {
      setJsonErr('One of the acceptance-contract fields is not valid JSON.');
      return null;
    }
    setJsonErr(null);
    const method = tier === 'T2' ? 'attest' : tier === 'T3' ? 'manual' : vmethod;
    return {
      name: name.trim(),
      description: description.trim(),
      category: category.trim() || undefined,
      pricingModel,
      pricePerCall: Number(price),
      endpoint: endpoint.trim(),
      stellarAddress: address.trim(),
      tier,
      verification: { method, spec },
      inputSchema,
      outputSchema,
    };
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const input = buildInput();
        if (input) reg.mutate(input);
      }}
      className="mt-4 space-y-3 rounded-xl bg-black/20 p-4"
    >
      <p className="text-xs leading-relaxed text-slate-400">
        Your service lists immediately as <span className="text-slate-300">New</span> and earns a{' '}
        <span className="text-emerald-300">Trusted</span> tier as it settles real jobs on-chain.
        Buyers pay you from their vault under a private, policy-bounded release, you are never given
        their key or their rule.
      </p>
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
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Stellar payout address (G…)"
            className={`${controls.field} font-mono`}
          />
          {hint(!addressOk, 'Must be a valid Stellar public key (G… , 56 chars).')}
        </div>
        <select
          value={pricingModel}
          onChange={(e) => setPricingModel(e.target.value as 'X402' | 'MPP')}
          className={controls.field}
          aria-label="Charging model"
        >
          <option value="X402">x402 (per call)</option>
          <option value="MPP">MPP (metered)</option>
        </select>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          How your delivery is verified (buyers pay only once it passes)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as 'T1' | 'T2' | 'T3')}
            className={controls.field}
            aria-label="Verification tier"
          >
            <option value="T1">T1 Verifiable (trustless)</option>
            <option value="T2">T2 Attestable (schema + dispute)</option>
            <option value="T3">T3 Human (approval/milestone)</option>
          </select>
          {tier === 'T1' && (
            <select
              value={vmethod}
              onChange={(e) => setVmethod(e.target.value)}
              className={controls.field}
              aria-label="Verification method"
            >
              <option value="onchain">onchain (re-derived on-chain)</option>
              <option value="witness">witness (re-checked by a predicate)</option>
              <option value="content-hash">content-hash</option>
              <option value="signature">signature</option>
            </select>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          T1 is paid only when the worker/chain re-checks your result (most trusted). T2 pays on the
          declared result shape with a dispute window. T3 waits for your buyer&apos;s approval.
        </p>
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer select-none text-slate-300">
            Advanced: verifier + result shape (JSON, optional)
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              value={specJson}
              onChange={(e) => setSpecJson(e.target.value)}
              placeholder={'Verifier spec, e.g. {"predicate":"sha256"} or {"signerKey":"G..."}'}
              className={`${controls.field} font-mono`}
              rows={2}
            />
            <textarea
              value={inJson}
              onChange={(e) => setInJson(e.target.value)}
              placeholder={
                'Input JSON Schema, e.g. {"type":"object","required":["data"],"properties":{"data":{"type":"string"}}}'
              }
              className={`${controls.field} font-mono`}
              rows={2}
            />
            <textarea
              value={outJson}
              onChange={(e) => setOutJson(e.target.value)}
              placeholder={'Output JSON Schema, e.g. {"type":"object","required":["sha256"]}'}
              className={`${controls.field} font-mono`}
              rows={2}
            />
          </div>
        </details>
        {jsonErr && <p className="text-xs text-red-400">{jsonErr}</p>}
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
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
                      <span
                        className={
                          s.trust === 'trusted'
                            ? 'font-semibold text-emerald-300'
                            : s.trust === 'active'
                              ? 'font-semibold text-violet-300'
                              : 'text-slate-500'
                        }
                      >
                        {s.trust === 'trusted' ? 'Trusted' : s.trust === 'active' ? 'Active' : 'New'}
                      </span>
                      <span>{s.tier}</span>
                      <span>{s.settlements} settled</span>
                      <span>{s.uniquePayers} payers</span>
                      {s.disputes > 0 && (
                        <span className="text-amber-300">
                          {s.disputesUpheld}/{s.disputes} disputes upheld
                        </span>
                      )}
                      {s.payoutReady === false && (
                        <span
                          className="font-semibold text-amber-300"
                          title="This service's payout wallet has no USDC trustline, so a hire can't pay it and will refund. Add a USDC trustline to the payout address."
                        >
                          ⚠ no USDC trustline (can&apos;t be paid)
                        </span>
                      )}
                    </div>
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
      <DisputesCard />
    </section>
  );
}

function statusTone(status: string): string {
  if (status === 'OPEN') return 'text-amber-300';
  if (status === 'RESOLVED') return 'text-emerald-300';
  return 'text-slate-400';
}

function DisputesCard() {
  const qc = useQueryClient();
  const {
    data: disputes = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['provider-disputes'], queryFn: getProviderDisputes });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const respond = useMutation({
    mutationFn: ({ id, response }: { id: string; response: string }) => respondToDispute(id, response),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-disputes'] }),
  });

  return (
    <Card className="p-5">
      <CardHeader
        icon={Flag}
        title="Disputes"
        hint="Disputes on tasks that used your services. Respond with your evidence."
      />
      <div className="px-5 pb-5">
        {isLoading ? (
          <Loading rows={2} />
        ) : error ? (
          <ErrorState>Could not load disputes.</ErrorState>
        ) : disputes.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No disputes. Good standing.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {disputes.map((d) => (
              <div key={d.id} className="rounded-xl bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{d.task ?? d.taskId}</span>
                  <span className={`text-xs font-semibold ${statusTone(d.status)}`}>{d.status}</span>
                </div>
                {d.reason && <p className="mt-1 text-sm text-slate-400">Buyer: {d.reason}</p>}
                {d.providerResponse ? (
                  <p className="mt-1 text-sm text-slate-300">Your response: {d.providerResponse}</p>
                ) : d.status === 'OPEN' ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const r = (drafts[d.id] ?? '').trim();
                      if (r) respond.mutate({ id: d.id, response: r });
                    }}
                    className="mt-2 flex gap-2"
                  >
                    <input
                      value={drafts[d.id] ?? ''}
                      onChange={(e) => setDrafts((s) => ({ ...s, [d.id]: e.target.value }))}
                      placeholder="Your evidence or response"
                      className={controls.field}
                    />
                    <button type="submit" disabled={respond.isPending} className={controls.primary}>
                      Respond
                    </button>
                  </form>
                ) : null}
                {d.resolution && (
                  <p className="mt-1 text-xs text-slate-500">Resolution: {d.resolution}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
