import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Star,
  Zap,
  Clock,
  Briefcase,
  BadgeCheck,
  Award,
  Lock,
  ShieldCheck,
  Paperclip,
  X,
} from 'lucide-react';
import {
  getService,
  getPlatformFeeBps,
  tierLabel,
  verificationBlurb,
  type JsonSchema,
} from '../lib/services';
import { createTask } from '../lib/tasks';
import { getDelegate } from '../lib/vault';
import { uploadFile } from '../lib/uploads';

/** Turn an input-schema key into a readable label: "walletAddress" -> "Wallet address". */
function humanizeField(k: string): string {
  const s = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fallback hint when the schema has no description, keyed off the field name. */
function fieldHint(k: string): string {
  const key = k.toLowerCase();
  if (key.includes('address') || key === 'account' || key.includes('wallet'))
    return 'The Stellar account this job is about (what to look up) — not a payment; the fee comes from your vault.';
  if (
    key.includes('data') ||
    key.includes('text') ||
    key.includes('message') ||
    key.includes('content')
  )
    return 'The text/content for the service to process.';
  if (key.includes('url') || key.includes('endpoint') || key.includes('link'))
    return 'A URL for the service to fetch.';
  return 'Input this service needs to run the job.';
}

/** A concrete example placeholder, keyed off the field name. */
function placeholderFor(k: string): string {
  const key = k.toLowerCase();
  if (key.includes('address') || key === 'account' || key.includes('wallet'))
    return 'G… (a Stellar account address)';
  if (key.includes('url') || key.includes('endpoint') || key.includes('link')) return 'https://…';
  if (key.includes('amount') || key.includes('price')) return 'e.g. 10';
  if (
    key.includes('data') ||
    key.includes('text') ||
    key.includes('message') ||
    key.includes('content')
  )
    return 'Text to process…';
  return `Enter ${humanizeField(k).toLowerCase()}`;
}

function HireBox({
  serviceId,
  serviceName,
  inputSchema,
}: {
  serviceId: string;
  serviceName: string;
  inputSchema: JsonSchema | null;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [budget, setBudget] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // Values the buyer types for the service's declared inputs (e.g. data, address).
  const [fields, setFields] = useState<Record<string, string>>({});
  const { data: feeBps = 0 } = useQuery({ queryKey: ['platform-fee'], queryFn: getPlatformFeeBps });
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });

  const props = inputSchema?.properties ?? {};
  const propKeys = Object.keys(props);
  const required = inputSchema?.required ?? [];
  const missingRequired = required.filter((k) => !fields[k]?.trim());

  const hire = useMutation({
    mutationFn: async () => {
      // Build the job input: the service's declared fields (non-empty) plus an
      // optional uploaded attachment (direct to R2). The provider receives this.
      const input: Record<string, unknown> = {};
      for (const k of propKeys) if (fields[k]?.trim()) input[k] = fields[k].trim();
      if (file) input.attachment = await uploadFile(file);
      const hasInput = Object.keys(input).length > 0;
      return createTask({
        title: `Pay ${serviceName}`,
        mode: 'DIRECT',
        budget: Number(budget),
        serviceId,
        ...(hasInput ? { input } : {}),
      });
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/app/tasks/${task.id}`);
    },
  });

  const budgetNum = Number(budget);
  const canSubmit =
    budget !== '' &&
    Number.isFinite(budgetNum) &&
    budgetNum > 0 &&
    missingRequired.length === 0 &&
    !hire.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) hire.mutate();
      }}
      className="rounded-2xl bg-white/[0.04] p-6"
    >
      <h2 className="font-semibold text-slate-300">Hire this service</h2>
      <p className="mt-1 text-sm text-slate-400">
        Creates a direct job you can track in your buyer console.
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-300">
        <Lock size={12} /> Paid from your vault under your private, on-chain-enforced policy.
      </p>
      {feeBps > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          A {(feeBps / 100).toFixed(2)}% protocol fee is taken on settlement.
        </p>
      )}
      <input
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        inputMode="decimal"
        placeholder="Budget (USDC)"
        className="mt-4 w-full rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
      />
      {propKeys.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            What this service needs from you
          </div>
          {propKeys.map((k) => (
            <label key={k} className="block">
              <span className="text-xs font-medium text-slate-300">
                {humanizeField(k)}
                {required.includes(k) && <span className="text-amber-300"> *</span>}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                {props[k]?.description ?? fieldHint(k)}
              </span>
              <input
                value={fields[k] ?? ''}
                onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                placeholder={placeholderFor(k)}
                className="mt-1 w-full rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
              />
            </label>
          ))}
        </div>
      )}
      {file ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
          <Paperclip size={12} className="shrink-0 text-violet-300" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="shrink-0 text-slate-500 hover:text-white"
            aria-label="Remove attachment"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-slate-400 hover:border-violet-500/40 hover:text-slate-300">
          <Paperclip size={12} /> Attach a file (optional)
          <input
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-3 w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {hire.isPending ? (file ? 'Uploading + creating…' : 'Creating…') : 'Hire now'}
      </button>
      {hire.error && (
        <p className="mt-2 text-sm text-red-400">
          {(hire.error as Error).message || 'Could not create the job.'}
        </p>
      )}
      {delegate && !delegate.registered && (
        <p className="mt-2 text-xs text-amber-300">
          Your settlement relayer isn&apos;t registered, so this hire will run but won&apos;t pay
          the provider until you{' '}
          <Link to="/app/vault" className="underline hover:text-amber-200">
            register the relayer
          </Link>
          .
        </p>
      )}
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
              {service.verified && (
                <span className="inline-flex items-center gap-1 text-sm text-sky-300">
                  <BadgeCheck size={15} /> Verified
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-sm text-amber-300">
                <Star size={14} /> {service.rating.toFixed(1)}
              </span>
              {service.trust === 'trusted' && (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-300">
                  <Award size={14} /> Trusted · {service.settlements} settled
                </span>
              )}
              {service.trust === 'active' && (
                <span className="text-sm text-violet-300">{service.settlements} settled</span>
              )}
              {service.trust === 'new' && (
                <span className="text-sm text-slate-500">New · unproven</span>
              )}
            </div>
            <p className="mt-1 text-slate-400">{service.description}</p>
            <p className="mt-1 text-sm text-slate-500">
              {service.category ?? 'Uncategorised'} · {service.provider}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Zap, label: 'Price / call', value: `$${service.pricePerCall}` },
              { icon: Briefcase, label: 'Settled jobs', value: String(service.settlements) },
              { icon: Star, label: 'Rating', value: service.rating.toFixed(1) },
              {
                icon: Clock,
                label: 'Avg latency',
                value: service.avgLatencyMs != null ? `${service.avgLatencyMs}ms` : 'n/a',
              },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/[0.04] p-4">
                <s.icon size={16} className="text-violet-300" />
                <div className="mt-2 text-xl font-bold">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div
            className={`rounded-2xl border p-5 ${
              service.tier === 'T1'
                ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                : 'border-violet-500/20 bg-violet-500/[0.06]'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck
                size={16}
                className={service.tier === 'T1' ? 'text-emerald-300' : 'text-violet-300'}
              />
              <h2 className="font-semibold text-slate-200">
                How you&apos;re protected · {tierLabel(service.tier)}
              </h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {verificationBlurb(service.tier, service.verification)}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Lock size={12} /> Paid from your vault under your private, on-chain-enforced policy,
              only on an accepted result.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-white/[0.04] p-6">
              <h2 className="font-semibold text-slate-300">Capabilities</h2>
              {service.capabilities.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No capabilities listed.</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {service.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-slate-300"
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

            <HireBox
              serviceId={service.id}
              serviceName={service.name}
              inputSchema={service.inputSchema}
            />
          </div>
        </>
      )}
    </section>
  );
}
