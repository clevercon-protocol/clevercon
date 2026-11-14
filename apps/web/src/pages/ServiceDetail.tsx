import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Check,
  ExternalLink,
  KeyRound,
  Boxes,
  Globe,
  FileText,
  LifeBuoy,
  Github,
} from 'lucide-react';
import {
  getService,
  getPlatformFeeBps,
  getServiceSetup,
  saveServiceSetup,
  tierLabel,
  verificationBlurb,
  interactionLabel,
  paymentModelLabel,
  pricingLabel,
  isMetered,
  type JsonSchema,
  type AttachmentSpec,
  type ServiceFunction,
  type ContactLinks,
  type ServiceSetupStatus,
} from '../lib/services';
import { createTask } from '../lib/tasks';
import { getGithubOAuthStatus, getGithubAuthorizeUrl } from '../lib/oauth';
import { getDelegate } from '../lib/vault';
import { uploadFile, validateAttachment } from '../lib/uploads';

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

function MeteredHireBox({ paymentModel }: { paymentModel?: string | null }) {
  const label = paymentModelLabel(paymentModel) ?? 'Metered';
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <h2 className="font-semibold text-slate-300">{label}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        This service bills per use, not as a one-off escrowed job. Your agent pays it directly from
        its own wallet, which you fund from your vault under your policy, so there is no budget to
        escrow here.
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-300">
        <ShieldCheck size={12} /> Protected by your capped private allowance (the on-chain policy),
        not by per-job escrow.
      </p>
      <Link
        to="/app/vault"
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500"
      >
        Set up your agent wallet
      </Link>
      <p className="mt-2 text-xs text-slate-500">
        Then point your agent at this service&apos;s endpoint; each call settles over{' '}
        {paymentModel === 'mpp-session' ? 'an MPP session' : 'x402'} from the agent wallet.
      </p>
    </div>
  );
}

/**
 * Usage requirements: what the buyer must set up before hiring (an authorization, an
 * install, an API key/credential, or info a prompt cannot carry). The buyer satisfies
 * them once; a secret is stored encrypted and shown only as "set", never echoed back.
 * The hire is gated server-side on these, so the agent asks for setup rather than
 * hiring a service that cannot run.
 */
function RequirementsPanel({ serviceId }: { serviceId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['service-setup', serviceId],
    queryFn: () => getServiceSetup(serviceId),
  });
  const { data: oauth } = useQuery({
    queryKey: ['gh-oauth-status'],
    queryFn: getGithubOAuthStatus,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState(false);
  // Show the outcome of an OAuth return (?connected=1/0), then clear it from the URL.
  const [params, setParams] = useSearchParams();
  const [connectResult, setConnectResult] = useState<string | null>(null);
  useEffect(() => {
    const c = params.get('connected');
    if (c == null) return;
    setConnectResult(c);
    qc.invalidateQueries({ queryKey: ['service-setup', serviceId] });
    const next = new URLSearchParams(params);
    next.delete('connected');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = useMutation({
    mutationFn: (v: Record<string, string>) => saveServiceSetup(serviceId, v),
    onSuccess: (d) => {
      qc.setQueryData(['service-setup', serviceId], d);
      setValues({});
    },
  });
  const connectGithub = async (key: string) => {
    setConnecting(true);
    try {
      window.location.href = await getGithubAuthorizeUrl(serviceId, key);
    } catch {
      setConnecting(false);
    }
  };
  const prereqs = data?.prerequisites ?? [];
  if (prereqs.length === 0) return null;
  const met = new Map((data?.requirements ?? []).map((r) => [r.key, r.satisfied]));
  const allMet = prereqs.every((p) => met.get(p.key));

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-violet-300" />
        <h2 className="font-semibold text-white">Usage requirements</h2>
        {allMet && (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            <Check size={10} /> All set
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Set these up once before hiring this service.
      </p>
      {connectResult === '1' && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          GitHub connected.
        </p>
      )}
      {connectResult === '0' && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Could not connect GitHub. Try again, or paste a token below.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {prereqs.map((p) => {
          const satisfied = !!met.get(p.key);
          const isField = p.kind === 'apiKey' || p.kind === 'info';
          const isOAuth = p.kind === 'oauth';
          return (
            <div key={p.key} className="rounded-xl bg-black/20 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                {satisfied ? (
                  <Check size={13} className="text-emerald-300" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                )}
                {p.label}
                {satisfied && (isOAuth || isField) && (
                  <button
                    type="button"
                    onClick={() => save.mutate({ [p.key]: '' })}
                    disabled={save.isPending}
                    className="ml-auto text-[11px] font-normal text-slate-500 hover:text-rose-300 disabled:opacity-50"
                  >
                    {isOAuth ? 'Disconnect' : 'Remove'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{p.instructions}</p>
              {p.url && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                >
                  Open setup <ExternalLink size={11} />
                </a>
              )}
              {isOAuth ? (
                <div className="mt-2 space-y-2">
                  {oauth?.configured && (
                    <button
                      type="button"
                      onClick={() => connectGithub(p.key)}
                      disabled={connecting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/15 disabled:opacity-60"
                    >
                      <Github size={13} /> {connecting ? 'Redirecting…' : satisfied ? 'Reconnect GitHub' : 'Connect GitHub'}
                    </button>
                  )}
                  {oauth?.configured && (
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      Reconnect is instant because GitHub keeps the app authorized. To switch
                      accounts or fully revoke access,{' '}
                      <a
                        href="https://github.com/settings/applications"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-200"
                      >
                        revoke it on GitHub <ExternalLink size={9} />
                      </a>{' '}
                      first, then connect again.
                    </p>
                  )}
                  {/* Fallback for anyone who prefers to paste a token (or when OAuth
                      is not configured on this server). Stored encrypted, like OAuth. */}
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer select-none hover:text-slate-300">
                      {oauth?.configured ? 'Or paste a token instead' : 'Paste a personal access token'}
                    </summary>
                    <input
                      type="password"
                      value={values[p.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                      placeholder={satisfied ? '•••••• (saved - enter to replace)' : 'ghp_… token'}
                      className="mt-2 w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
                      aria-label={`${p.label} token`}
                    />
                    <a
                      href="https://github.com/settings/tokens?type=beta"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      Create a fine-grained token <ExternalLink size={9} />
                    </a>
                  </details>
                </div>
              ) : isField ? (
                <input
                  type={p.secret ? 'password' : 'text'}
                  value={values[p.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={satisfied ? '•••••• (saved - enter to replace)' : p.label}
                  className="mt-2 w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/40"
                  aria-label={p.label}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => save.mutate({ [p.key]: satisfied ? '' : 'done' })}
                  disabled={save.isPending}
                  className="mt-2 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-violet-300 hover:bg-white/10 disabled:opacity-60"
                >
                  {satisfied ? 'Mark not done' : "I've done this"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => save.mutate(values)}
        disabled={Object.keys(values).length === 0 || save.isPending}
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-60"
      >
        {save.isPending ? 'Saving…' : 'Save requirements'}
      </button>
      {save.error && (
        <p className="mt-2 text-xs text-amber-300">{(save.error as Error).message}</p>
      )}
    </div>
  );
}

function HireBox({
  serviceId,
  serviceName,
  inputSchema,
  attachmentsIn,
  fn,
}: {
  serviceId: string;
  serviceName: string;
  inputSchema: JsonSchema | null;
  attachmentsIn: AttachmentSpec | null;
  /** The chosen function of a multi-function service; drives the input, price, and key. */
  fn?: ServiceFunction | null;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // A paid (per_call) function has a fixed price; prefill the budget with it. A free
  // function needs no charge but the escrow hire still takes a ceiling, so leave it
  // blank for the buyer to set.
  const fnAmount = fn && fn.pricing.model !== 'free' ? (fn.pricing.amount ?? 0) : null;
  const [budget, setBudget] = useState(fnAmount && fnAmount > 0 ? String(fnAmount) : '');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Values the buyer types for the service's declared inputs (e.g. data, address).
  const [fields, setFields] = useState<Record<string, string>>({});
  const { data: feeBps = 0 } = useQuery({ queryKey: ['platform-fee'], queryFn: getPlatformFeeBps });
  const { data: delegate } = useQuery({ queryKey: ['delegate'], queryFn: getDelegate });

  // A chosen function's own input schema takes precedence over the service's.
  const effInputSchema = (fn?.input ?? inputSchema) as JsonSchema | null;
  const props = effInputSchema?.properties ?? {};
  const propKeys = Object.keys(props);
  const required = effInputSchema?.required ?? [];
  const missingRequired = required.filter((k) => !fields[k]?.trim());
  // The provider declared it needs a file to run the job: block the hire until one
  // is attached, and surface the accepted types.
  const fileRequired = !!attachmentsIn?.required;
  const acceptHint = attachmentsIn?.accept?.length ? attachmentsIn.accept.join(', ') : null;

  const hire = useMutation({
    mutationFn: async () => {
      // Build the job input: the service's declared fields (non-empty) plus an
      // optional uploaded attachment (direct to R2). The provider receives this.
      const input: Record<string, unknown> = {};
      for (const k of propKeys) if (fields[k]?.trim()) input[k] = fields[k].trim();
      // Plural `attachments` (an ArtifactRef[]) is what the worker lifts into the job
      // envelope (JobRequestEnvelope.attachments) so the provider SDK receives it as
      // req.attachments. (A singular `attachment` would stay buried in input.)
      if (file) input.attachments = [await uploadFile(file)];
      const hasInput = Object.keys(input).length > 0;
      return createTask({
        title: fn ? `${serviceName}: ${fn.label}` : `Pay ${serviceName}`,
        mode: 'DIRECT',
        budget: Number(budget),
        serviceId,
        ...(fn ? { functionKey: fn.key } : {}),
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
    (!fileRequired || !!file) &&
    !hire.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) hire.mutate();
      }}
      className="rounded-2xl bg-white/[0.04] p-6"
    >
      <h2 className="font-semibold text-slate-300">
        {fn ? `Hire: ${fn.label}` : 'Hire this service'}
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        {fn ? (
          <>
            {fn.description || 'Creates a direct job you can track in your buyer console.'}{' '}
            <span className="text-slate-300">· {pricingLabel(fn.pricing)}</span>
          </>
        ) : (
          'Creates a direct job you can track in your buyer console.'
        )}
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-300">
        <Lock size={12} /> Paid from your vault under your private, on-chain-enforced policy.
      </p>
      {feeBps > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          A {(feeBps / 100).toFixed(2)}% protocol fee is taken on settlement.
        </p>
      )}
      <label className="mt-4 block">
        <span className="text-xs font-medium text-slate-300">
          Budget (USDC)<span className="text-rose-400"> *</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-500">
          {fn ? `This function costs ${pricingLabel(fn.pricing)}. ` : ''}The most this job can spend; you are charged only the agreed price.
        </span>
        <input
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          inputMode="decimal"
          placeholder="e.g. 0.02"
          className="mt-1 w-full rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
      </label>
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
      {/* Only a service that DECLARES it takes input files (attachmentsIn) shows an
          attacher; otherwise attaching a file the provider ignores would mislead. */}
      {attachmentsIn &&
        (file ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
            <Paperclip size={12} className="shrink-0 text-violet-300" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setFileError(null);
              }}
              className="shrink-0 text-slate-500 hover:text-white"
              aria-label="Remove attachment"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs hover:border-violet-500/40 hover:text-slate-300 ${
                fileRequired ? 'border-amber-500/40 text-amber-300' : 'border-white/10 text-slate-400'
              }`}
            >
              <Paperclip size={12} />
              {fileRequired ? 'Attach a file (required)' : 'Attach a file (optional)'}
              {acceptHint && <span className="text-slate-500">· {acceptHint}</span>}
              <input
                type="file"
                className="hidden"
                {...(attachmentsIn.accept?.length ? { accept: attachmentsIn.accept.join(',') } : {})}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  const err = f ? validateAttachment(f, attachmentsIn) : null;
                  if (err) {
                    setFileError(err);
                    setFile(null);
                  } else {
                    setFileError(null);
                    setFile(f);
                  }
                }}
              />
            </label>
            {fileError && <p className="mt-1 text-[11px] text-red-400">{fileError}</p>}
          </div>
        ))}
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

/**
 * All of a service's functions, each with its own pricing and the requirements it
 * needs (shown satisfied/unmet when the buyer is known). The buyer/agent sees exactly
 * what each function costs and what it must set up, and picks one to hire. A function
 * with unmet requirements is marked so, pointing at the setup panel.
 */
function FunctionsPanel({
  functions,
  prerequisites,
  setup,
  selectedKey,
  onSelect,
  metered,
}: {
  functions: ServiceFunction[];
  prerequisites: { key: string; label: string }[];
  setup?: ServiceSetupStatus;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  metered: boolean;
}) {
  const labelOf = new Map(prerequisites.map((p) => [p.key, p.label]));
  const satisfied = new Map((setup?.requirements ?? []).map((r) => [r.key, r.satisfied]));
  const isMeteredFn = (f: ServiceFunction) =>
    f.interaction === 'metered' ||
    f.pricing.model === 'per_usage' ||
    f.pricing.model === 'subscription';

  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2">
        <Boxes size={16} className="text-violet-300" />
        <h2 className="font-semibold text-white">Functions</h2>
        <span className="text-xs text-slate-500">{functions.length}</span>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Each is priced and gated on its own. Pick one to hire; you are charged only for what
        you use.
      </p>
      <div className="mt-4 space-y-2.5">
        {functions.map((f) => {
          const unmet = (f.requires ?? []).filter((k) => !satisfied.get(k));
          const selected = selectedKey === f.key;
          const hireable = !metered && !isMeteredFn(f);
          return (
            <div
              key={f.key}
              className={`rounded-xl border p-3.5 ${
                selected ? 'border-violet-400/50 bg-violet-500/[0.08]' : 'border-white/10 bg-black/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">{f.label}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-300">
                      {pricingLabel(f.pricing)}
                    </span>
                  </div>
                  <code className="text-[10px] text-slate-500">{f.key}</code>
                  {f.description && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.description}</p>
                  )}
                </div>
                {hireable ? (
                  <button
                    type="button"
                    onClick={() => onSelect(f.key)}
                    className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium ${
                      selected
                        ? 'bg-violet-600 text-white'
                        : 'bg-white/[0.06] text-violet-300 hover:bg-white/10'
                    }`}
                  >
                    {selected ? 'Selected' : 'Hire this'}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                    metered
                  </span>
                )}
              </div>
              {(f.requires?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">needs</span>
                  {(f.requires ?? []).map((k) => {
                    const ok = satisfied.get(k);
                    return (
                      <span
                        key={k}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                          ok
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {ok ? <Check size={10} /> : <KeyRound size={10} />}
                        {labelOf.get(k) ?? k}
                      </span>
                    );
                  })}
                </div>
              )}
              {selected && unmet.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-300">
                  Set up {unmet.map((k) => labelOf.get(k) ?? k).join(', ')} below before hiring.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Who listed this service and how to reach them, before granting any access. */
function ContactCard({ links }: { links: ContactLinks }) {
  const asUrl = (v: string) =>
    v.startsWith('http') || v.includes('@') ? (v.includes('@') ? `mailto:${v}` : v) : `https://${v}`;
  const rows: { k: keyof ContactLinks; label: string; icon: typeof Globe }[] = [
    { k: 'website', label: 'Website', icon: Globe },
    { k: 'docs', label: 'Docs', icon: FileText },
    { k: 'support', label: 'Support', icon: LifeBuoy },
    { k: 'github', label: 'GitHub', icon: Github },
    { k: 'x', label: 'X', icon: ExternalLink },
    { k: 'discord', label: 'Discord', icon: ExternalLink },
  ];
  const present = rows.filter((r) => (links[r.k] ?? '').trim());
  if (present.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <h2 className="font-semibold text-slate-300">Owner &amp; links</h2>
      <p className="mt-1 text-sm text-slate-400">Who lists this and where to verify it.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {present.map(({ k, label, icon: Icon }) => (
          <a
            key={k}
            href={asUrl(links[k] as string)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <Icon size={13} className="text-violet-300" /> {label}
          </a>
        ))}
      </div>
    </div>
  );
}

export function ServiceDetail() {
  const { id = '' } = useParams();
  const {
    data: service,
    isLoading,
    error,
  } = useQuery({ queryKey: ['service', id], queryFn: () => getService(id) });

  const functions = service?.functions ?? [];
  const multi = functions.length > 0;
  // The function the buyer has chosen to hire (default: the first). Shared cache with
  // the RequirementsPanel so a function's requirement status reflects saved setup.
  const [selectedFn, setSelectedFn] = useState<string | null>(null);
  const { data: setup } = useQuery({
    queryKey: ['service-setup', id],
    queryFn: () => getServiceSetup(id),
    enabled: multi && (service?.prerequisites?.length ?? 0) > 0,
    retry: false,
  });
  // Default to the first hireable (non-metered) function, so a hire isn't pre-aimed at
  // a metered function the escrow box can't settle.
  const serviceMetered = service ? isMetered(service) : false;
  const hireable = (f: ServiceFunction) =>
    !serviceMetered &&
    f.interaction !== 'metered' &&
    f.pricing.model !== 'per_usage' &&
    f.pricing.model !== 'subscription';
  const chosenKey = selectedFn ?? functions.find(hireable)?.key ?? functions[0]?.key ?? null;
  const chosenFn = multi ? (functions.find((f) => f.key === chosenKey) ?? null) : null;

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
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
              {service.owner ? (
                <>
                  by{' '}
                  {service.owner.handle ? (
                    <Link
                      to={`/p/${service.owner.handle}`}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                    >
                      {service.owner.name}
                      {service.owner.verified && (
                        <BadgeCheck size={14} className="text-sky-300" aria-label="Verified" />
                      )}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-300">
                      {service.owner.name}
                      {service.owner.verified && (
                        <BadgeCheck size={14} className="text-sky-300" aria-label="Verified" />
                      )}
                    </span>
                  )}
                  <span>·</span>
                </>
              ) : null}
              <span>{service.category ?? 'Uncategorised'}</span>
              {multi && <span>· {functions.length} functions</span>}
            </p>
            {(interactionLabel(service.interaction) ||
              paymentModelLabel(service.paymentModel) ||
              service.attachmentsIn?.required) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {paymentModelLabel(service.paymentModel) && (
                  <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] text-violet-300">
                    {paymentModelLabel(service.paymentModel)}
                  </span>
                )}
                {interactionLabel(service.interaction) && (
                  <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] text-sky-300">
                    {interactionLabel(service.interaction)}
                  </span>
                )}
                {service.attachmentsIn?.required && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300">
                    <Paperclip size={10} /> Needs a file
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              multi
                ? { icon: Boxes, label: 'Functions', value: String(functions.length) }
                : { icon: Zap, label: 'Price / call', value: `$${service.pricePerCall}` },
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

          {multi && (
            <FunctionsPanel
              functions={functions}
              prerequisites={service.prerequisites ?? []}
              setup={setup}
              selectedKey={chosenKey}
              onSelect={setSelectedFn}
              metered={isMetered(service)}
            />
          )}

          {service.contactLinks && <ContactCard links={service.contactLinks} />}

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-white/[0.04] p-6">
              <h2 className="font-semibold text-slate-300">{multi ? 'Details' : 'Capabilities'}</h2>
              {/* Multi-function services show their operations in the Functions panel
                  above, so the raw capability keys would only duplicate them here. */}
              {!multi &&
                (service.capabilities.length === 0 ? (
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
                ))}
              <dl className="mt-6 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Pricing</dt>
                  <dd className="text-slate-300">
                    {multi
                      ? 'Per function (see Functions)'
                      : `${paymentModelLabel(service.paymentModel) ?? 'Pay on delivery'} · ${service.currency}`}
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

            {!isMetered(service) && (service.prerequisites?.length ?? 0) > 0 && (
              <RequirementsPanel serviceId={service.id} />
            )}

            {service.healthy === false ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6">
                <div className="flex items-center gap-2 text-amber-200">
                  <Clock size={16} />
                  <h2 className="font-semibold">Temporarily unavailable</h2>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This service&apos;s endpoint is not responding to its health check, so it is
                  hidden from the marketplace and cannot be hired right now. It relists
                  automatically once the provider&apos;s endpoint recovers.
                </p>
              </div>
            ) : isMetered(service) ? (
              <MeteredHireBox paymentModel={service.paymentModel} />
            ) : (
              <HireBox
                key={chosenKey ?? 'default'}
                serviceId={service.id}
                serviceName={service.name}
                inputSchema={service.inputSchema}
                attachmentsIn={service.attachmentsIn ?? null}
                fn={chosenFn}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
