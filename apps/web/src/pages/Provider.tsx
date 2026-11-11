import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  Briefcase,
  Star,
  Boxes,
  Plus,
  Flag,
  Receipt,
  Download,
  ExternalLink,
  Activity,
  Pencil,
  KeyRound,
  FileInput,
  FileOutput,
} from 'lucide-react';
import {
  getProviderServices,
  getProviderEarnings,
  getProviderJobs,
  getProviderDisputes,
  getProviderPayouts,
  getProviderMetrics,
  payoutsToCsv,
  respondToDispute,
  registerService,
  updateService,
  setServiceStatus,
  type RegisterServiceInput,
  type ProviderServiceItem,
} from '../lib/provider';
import {
  getPlatformFeeBps,
  interactionLabel,
  paymentModelLabel,
  pricingLabel,
  type Prerequisite,
  type ContactLinks,
  type ServiceFunction,
} from '../lib/services';
import { getMyOrgs, createOrg, type OrgRef } from '../lib/org';
import { refreshRoles } from '../lib/sessionSync';
import { config } from '../config';

const EXPLORER_NET = config.network === 'mainnet' ? 'public' : 'testnet';
const explorerTx = (hash: string) => `https://stellar.expert/explorer/${EXPLORER_NET}/tx/${hash}`;
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

// A single property row in the visual schema builder.
type SchemaField = {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
};
const FIELD_TYPES: SchemaField['type'][] = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
];

// Best-effort parse of a stored JSON Schema object into editable rows. Returns null
// when the text isn't a plain object-schema we can represent as flat fields (the
// caller then falls back to the raw-JSON editor so nothing is lost).
function schemaToFields(json: string): SchemaField[] | null {
  const text = json.trim();
  if (!text) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const props = o.properties;
  if (props === undefined && o.type === undefined) return null;
  if (props !== undefined && (typeof props !== 'object' || Array.isArray(props))) return null;
  const required = Array.isArray(o.required) ? (o.required as unknown[]).map(String) : [];
  const entries = props ? Object.entries(props as Record<string, unknown>) : [];
  const fields: SchemaField[] = [];
  for (const [name, raw] of entries) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const t = p.type;
    if (typeof t !== 'string' || !FIELD_TYPES.includes(t as SchemaField['type'])) return null;
    fields.push({
      name,
      type: t as SchemaField['type'],
      required: required.includes(name),
      description: typeof p.description === 'string' ? p.description : '',
    });
  }
  return fields;
}

// Compile editable rows back into a JSON Schema object string ('' when empty).
function fieldsToSchema(fields: SchemaField[]): string {
  const named = fields.filter((f) => f.name.trim());
  if (named.length === 0) return '';
  const required = named.filter((f) => f.required).map((f) => f.name.trim());
  const properties: Record<string, unknown> = {};
  for (const f of named) {
    properties[f.name.trim()] = {
      type: f.type,
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
    };
  }
  return JSON.stringify({
    type: 'object',
    ...(required.length ? { required } : {}),
    properties,
  });
}

/**
 * Visual field-builder for an input/deliverable JSON Schema. Providers add named,
 * typed fields instead of hand-writing JSON; an "Edit as JSON" escape hatch stays
 * for schemas too complex for flat rows (and is auto-selected when we can't parse
 * an existing one). The compiled schema string is lifted via onChange.
 */
function SchemaBuilder({
  value,
  onChange,
  addLabel,
}: {
  value: string;
  onChange: (json: string) => void;
  addLabel: string;
}) {
  const parsed = schemaToFields(value);
  const [fields, setFields] = useState<SchemaField[]>(parsed ?? []);
  // Raw mode when the stored schema can't be represented as flat rows.
  const [raw, setRaw] = useState(parsed === null);

  const commit = (next: SchemaField[]) => {
    setFields(next);
    onChange(fieldsToSchema(next));
  };
  const add = () =>
    commit([...fields, { name: '', type: 'string', required: false, description: '' }]);
  const patch = (i: number, p: Partial<SchemaField>) =>
    commit(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const remove = (i: number) => commit(fields.filter((_, j) => j !== i));

  if (raw) {
    return (
      <div className="space-y-1.5">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'JSON Schema, e.g. {"type":"object","required":["operation"],"properties":{"operation":{"type":"string"}}}'}
          className={`${controls.field} font-mono`}
          rows={3}
        />
        <button
          type="button"
          onClick={() => {
            const f = schemaToFields(value);
            if (f) {
              setFields(f);
              setRaw(false);
            }
          }}
          className="text-[11px] font-medium text-violet-300 hover:text-violet-200 disabled:opacity-40"
          disabled={schemaToFields(value) === null}
          title={schemaToFields(value) === null ? 'This JSON is too complex for the field view' : ''}
        >
          Use field builder
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {fields.length > 0 && (
        <div className="space-y-1.5">
          {fields.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <input
                value={f.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                placeholder="field name"
                className={`${controls.field} font-mono sm:flex-1`}
                aria-label="Field name"
              />
              <select
                value={f.type}
                onChange={(e) => patch(i, { type: e.target.value as SchemaField['type'] })}
                className={controls.field}
                aria-label="Field type"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={f.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="description (optional)"
                className={`${controls.field} sm:flex-[2]`}
                aria-label="Field description"
              />
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
                req
              </label>
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded px-1.5 text-xs text-slate-500 hover:text-red-300"
                aria-label="Remove field"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          className="text-[11px] font-medium text-violet-300 hover:text-violet-200"
        >
          {addLabel}
        </button>
        <button
          type="button"
          onClick={() => setRaw(true)}
          className="text-[11px] text-slate-500 hover:text-slate-300"
        >
          Edit as JSON
        </button>
      </div>
    </div>
  );
}

/** A labeled form field with an optional required marker, hint, and inline error. */
function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </span>
      {hint && (
        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>
      )}
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </label>
  );
}

/** A titled section card to group the form into clear, labeled blocks. */
function Section({
  title,
  required,
  hint,
  children,
}: {
  title: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">
          {title}
          {required && <span className="text-rose-400"> *</span>}
        </h3>
        {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// An editable function row (schemas are kept as JSON strings for the SchemaBuilder).
type PriceModel = 'free' | 'per_call' | 'per_usage' | 'subscription';
type FnDraft = {
  key: string;
  label: string;
  description: string;
  inJson: string;
  outJson: string;
  requires: string[];
  pricingModel: PriceModel;
  amount: string;
  unit: string;
  period: 'day' | 'week' | 'month';
  tier: 'T1' | 'T2' | 'T3';
};
const emptyFn = (): FnDraft => ({
  key: '',
  label: '',
  description: '',
  inJson: '',
  outJson: '',
  requires: [],
  pricingModel: 'free',
  amount: '',
  unit: '',
  period: 'month',
  tier: 'T2',
});
// A stable, URL-safe key from a label (used when the provider leaves `key` blank).
function slugKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * The multi-function builder: each function carries its own input/output spec, the
 * requirement keys it needs (checked against the service's requirement catalog), and
 * its own pricing. A buyer is gated and charged per function, so one service can mix
 * free reads with paid writes, each needing different authorizations.
 */
function FunctionsEditor({
  functions,
  setFunctions,
  requirements,
}: {
  functions: FnDraft[];
  setFunctions: (f: FnDraft[]) => void;
  requirements: Prerequisite[];
}) {
  const patch = (i: number, p: Partial<FnDraft>) =>
    setFunctions(functions.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const remove = (i: number) => setFunctions(functions.filter((_, j) => j !== i));
  const toggleReq = (i: number, key: string) =>
    patch(i, {
      requires: functions[i].requires.includes(key)
        ? functions[i].requires.filter((k) => k !== key)
        : [...functions[i].requires, key],
    });

  return (
    <div className="space-y-2">
      {functions.map((f, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300">Function {i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-red-300"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name" required>
              <input
                value={f.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="e.g. Create issue"
                className={controls.field}
                aria-label="Function name"
              />
            </Field>
            <Field label="Action key" hint="The exact action sent to your endpoint. Auto from the name.">
              <input
                value={f.key}
                onChange={(e) => patch(i, { key: e.target.value })}
                placeholder={f.label ? slugKey(f.label) : 'e.g. create_issue'}
                className={`${controls.field} font-mono`}
                aria-label="Function key"
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              value={f.description}
              onChange={(e) => patch(i, { description: e.target.value })}
              placeholder="What this function does (shown to the agent)"
              className={controls.field}
              aria-label="Function description"
            />
          </Field>
          <Field
            label="How delivery is verified"
            hint="T1 trustless re-check, T2 result shape + dispute window, T3 your approval."
          >
            <select
              value={f.tier}
              onChange={(e) => patch(i, { tier: e.target.value as 'T1' | 'T2' | 'T3' })}
              className={controls.field}
              aria-label="Verification tier"
            >
              <option value="T1">T1 Verifiable (trustless)</option>
              <option value="T2">T2 Attestable (schema + dispute)</option>
              <option value="T3">T3 Human (approval)</option>
            </select>
          </Field>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <span className="text-[11px] font-medium text-slate-400">Input the agent provides</span>
              <div className="mt-1">
                <SchemaBuilder
                  value={f.inJson}
                  onChange={(v) => patch(i, { inJson: v })}
                  addLabel="+ Add input field"
                />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-400">Deliverable it returns</span>
              <div className="mt-1">
                <SchemaBuilder
                  value={f.outJson}
                  onChange={(v) => patch(i, { outJson: v })}
                  addLabel="+ Add result field"
                />
              </div>
            </div>
          </div>

          {/* Pricing for THIS function. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">
              Pricing<span className="text-rose-400"> *</span>
            </span>
            <select
              value={f.pricingModel}
              onChange={(e) => patch(i, { pricingModel: e.target.value as PriceModel })}
              className={controls.field}
              aria-label="Pricing model"
            >
              <option value="free">Free</option>
              <option value="per_call">Per call</option>
              <option value="per_usage">Per usage</option>
              <option value="subscription">Subscription</option>
            </select>
            {f.pricingModel !== 'free' && (
              <input
                value={f.amount}
                onChange={(e) => patch(i, { amount: e.target.value })}
                inputMode="decimal"
                placeholder="USDC amount"
                className={`${controls.field} max-w-[9rem]`}
                aria-label="Price amount"
              />
            )}
            {f.pricingModel === 'per_usage' && (
              <input
                value={f.unit}
                onChange={(e) => patch(i, { unit: e.target.value })}
                placeholder="per unit (e.g. 1k tokens, MB)"
                className={`${controls.field} max-w-[12rem]`}
                aria-label="Usage unit"
              />
            )}
            {f.pricingModel === 'subscription' && (
              <select
                value={f.period}
                onChange={(e) => patch(i, { period: e.target.value as 'day' | 'week' | 'month' })}
                className={controls.field}
                aria-label="Billing period"
              >
                <option value="day">per day</option>
                <option value="week">per week</option>
                <option value="month">per month</option>
              </select>
            )}
            {(f.pricingModel === 'per_usage' || f.pricingModel === 'subscription') && (
              <span className="text-[10px] text-amber-300/80">
                metered: paid from the agent wallet, not an escrow hire
              </span>
            )}
          </div>

          {/* Requirements this function needs, chosen from the catalog below. */}
          {requirements.length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-slate-400">Requirements this needs</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {requirements.map((r) => (
                  <label
                    key={r.key}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      f.requires.includes(r.key)
                        ? 'border-violet-400/60 bg-violet-500/15 text-violet-100'
                        : 'border-white/10 text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={f.requires.includes(r.key)}
                      onChange={() => toggleReq(i, r.key)}
                    />
                    {r.label || r.key}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setFunctions([...functions, emptyFn()])}
        className="text-xs font-medium text-violet-300 hover:text-violet-200"
      >
        + Add function
      </button>
    </div>
  );
}

/** Public contact/identity links for the service and its owner. */
function ContactLinksEditor({
  value,
  onChange,
}: {
  value: ContactLinks;
  onChange: (v: ContactLinks) => void;
}) {
  const set = (k: keyof ContactLinks, v: string) => onChange({ ...value, [k]: v });
  const fields: { k: keyof ContactLinks; ph: string }[] = [
    { k: 'website', ph: 'Website (https://...)' },
    { k: 'docs', ph: 'Docs (https://...)' },
    { k: 'support', ph: 'Support (email or URL)' },
    { k: 'github', ph: 'GitHub (https://github.com/...)' },
    { k: 'x', ph: 'X / Twitter (@handle or URL)' },
    { k: 'discord', ph: 'Discord (invite URL)' },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map(({ k, ph }) => (
        <input
          key={k}
          value={value[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
          placeholder={ph}
          className={controls.field}
          aria-label={ph}
        />
      ))}
    </div>
  );
}

/** Choose who lists the service: yourself or an organization you belong to (with an
 *  inline create). An org's admin-granted verified tick carries to its services. */
function OwnerSelect({
  value,
  onChange,
  orgs,
}: {
  value: string;
  onChange: (v: string) => void;
  orgs: OrgRef[];
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const create = useMutation({
    mutationFn: () => createOrg({ name: name.trim(), handle: handle.trim().toLowerCase() }),
    onSuccess: (org) => {
      qc.invalidateQueries({ queryKey: ['my-orgs'] });
      onChange(org.id);
      setCreating(false);
      setName('');
      setHandle('');
    },
  });
  return (
    <Field
      label="Listed by"
      hint="Shown as the service owner. An organization's verified tick carries to its services."
    >
      {!creating ? (
        <div className="flex gap-2">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={controls.field}
            aria-label="Owner"
          >
            <option value="">Yourself</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.verified ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`${controls.chip} shrink-0`}
          >
            <Plus size={13} /> Organization
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organization name (e.g. CleverCon)"
            className={controls.field}
            aria-label="Organization name"
          />
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="handle (e.g. clevercon)"
            className={`${controls.field} font-mono`}
            aria-label="Organization handle"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!name.trim() || !handle.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            {create.error && (
              <span className="text-xs text-rose-400">{(create.error as Error).message}</span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            New organizations start unverified; an admin grants the verified tick.
          </p>
        </div>
      )}
    </Field>
  );
}

function RegisterForm({ edit, onDone }: { edit?: ProviderServiceItem | null; onDone: () => void }) {
  const qc = useQueryClient();
  // Pre-fill every field from the service being edited (the owner's own view carries
  // the full manifest); a blank form for a new registration.
  const jsonOf = (v: unknown) => (v ? JSON.stringify(v, null, 2) : '');
  const editInteraction =
    edit?.interaction === 'async' || edit?.interaction === 'human' ? edit.interaction : 'sync';
  const [name, setName] = useState(edit?.name ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [category, setCategory] = useState(edit?.category ?? '');
  const [price, setPrice] = useState(edit ? String(edit.pricePerCall) : '');
  const [endpoint, setEndpoint] = useState(edit?.endpoint ?? '');
  const [capability, setCapability] = useState(edit?.capabilities?.[0] ?? '');
  const [address, setAddress] = useState(edit?.stellarAddress ?? '');
  const [paymentModel, setPaymentModel] = useState<
    'escrow' | 'x402' | 'mpp-session' | 'subscription'
  >((edit?.paymentModel as 'escrow' | 'x402' | 'mpp-session' | 'subscription') ?? 'escrow');
  const [interaction, setInteraction] = useState<'sync' | 'async' | 'human'>(editInteraction);
  const [needsFile, setNeedsFile] = useState(!!edit?.attachmentsIn?.required);
  const [accept, setAccept] = useState(edit?.attachmentsIn?.accept?.join(', ') ?? '');
  // Acceptance contract: how delivery is judged before you are paid.
  const [tier, setTier] = useState<'T1' | 'T2' | 'T3'>(
    (edit?.tier as 'T1' | 'T2' | 'T3') ?? 'T2',
  );
  const [vmethod, setVmethod] = useState<string>(edit?.verification?.method ?? 'onchain');
  const [specJson, setSpecJson] = useState(jsonOf(edit?.verification?.spec));
  const [inJson, setInJson] = useState(jsonOf(edit?.inputSchema));
  const [outJson, setOutJson] = useState(jsonOf(edit?.outputSchema));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  // Usage requirements a buyer must set up before hiring (auth/install/API key/info).
  const [prereqs, setPrereqs] = useState<Prerequisite[]>(
    edit?.prerequisites?.map((p) => ({
      kind: p.kind,
      key: p.key,
      label: p.label,
      instructions: p.instructions,
      url: p.url,
      secret: p.secret,
    })) ?? [],
  );
  const addPrereq = () =>
    setPrereqs((ps) => [...ps, { kind: 'info', key: '', label: '', instructions: '' }]);
  const updatePrereq = (i: number, patch: Partial<Prerequisite>) =>
    setPrereqs((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePrereq = (i: number) => setPrereqs((ps) => ps.filter((_, j) => j !== i));
  // Multi-function: each function carries its own io, required requirement keys, and
  // pricing. Pre-filled from the edited service's declared functions.
  const [functions, setFunctions] = useState<FnDraft[]>(
    edit?.functions?.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description ?? '',
      inJson: jsonOf(f.input),
      outJson: jsonOf(f.output),
      requires: f.requires ?? [],
      pricingModel: f.pricing.model,
      amount: f.pricing.amount != null ? String(f.pricing.amount) : '',
      unit: f.pricing.unit ?? '',
      period: f.pricing.period ?? 'month',
      tier: (f.tier as 'T1' | 'T2' | 'T3') ?? 'T2',
    })) ?? [],
  );
  const [contact, setContact] = useState<ContactLinks>(edit?.contactLinks ?? {});
  // Whether this service is ONE operation (the simple fields above describe it) or
  // MANY functions (each with its own io, requirements, and price). A service edited
  // with declared functions opens in multi mode.
  const [mode, setMode] = useState<'single' | 'multi'>(
    edit?.functions?.length ? 'multi' : 'single',
  );
  const chooseMode = (m: 'single' | 'multi') => {
    setMode(m);
    // Entering multi mode with no functions yet: seed one so the builder isn't empty.
    if (m === 'multi' && functions.length === 0) setFunctions([emptyFn()]);
  };
  // Who lists the service: yourself ('') or an organization you belong to.
  const { data: myOrgs = [] } = useQuery({ queryKey: ['my-orgs'], queryFn: getMyOrgs });
  const [ownerOrgId, setOwnerOrgId] = useState<string>(edit?.ownerOrgId ?? '');

  const reg = useMutation({
    // pricingModel is fixed at register time: the update endpoint ignores it, so the
    // same built input serves both paths.
    mutationFn: (input: RegisterServiceInput) =>
      edit ? updateService(edit.id, input) : registerService(input),
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
  // In multi mode at least one function needs a name; single mode needs a price.
  const namedFns = functions.filter((f) => f.label.trim());
  const operationOk =
    mode === 'single'
      ? price !== '' && Number.isFinite(priceNum) && priceNum >= 0
      : namedFns.length > 0;
  const canSubmit =
    !!name.trim() &&
    !!description.trim() &&
    isUrl(endpoint.trim()) &&
    STELLAR_ADDR.test(address.trim()) &&
    operationOk &&
    !reg.isPending;

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
    // A metered payment model (x402/MPP/subscription) is paid per use, so its
    // interaction is 'metered'; an escrow service keeps the chosen sync/async/human.
    const metered = paymentModel !== 'escrow';
    const pricingModel = paymentModel === 'mpp-session' ? 'MPP' : 'X402';
    // Required input file (escrow services only; a metered call carries its own input).
    const acceptList = accept
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const attachmentsIn =
      !metered && needsFile
        ? { required: true, ...(acceptList.length ? { accept: acceptList } : {}) }
        : undefined;
    // Only fully-specified requirements go up; a secret value (API key/token) is stored
    // encrypted and sent to your endpoint as `credentials`, never shown to the buyer again.
    const prerequisites = prereqs
      .filter((p) => p.key.trim() && p.label.trim() && p.instructions.trim())
      .map((p) => ({
        kind: p.kind,
        key: p.key.trim(),
        label: p.label.trim(),
        instructions: p.instructions.trim(),
        ...(p.url?.trim() ? { url: p.url.trim() } : {}),
        ...(p.secret ? { secret: true } : {}),
      }));
    // Map the function drafts, parsing each function's io schemas. Only functions with
    // a label go up; the key defaults to a slug of the label. Keys must be unique.
    let fnError: string | null = null;
    const functionsOut: ServiceFunction[] = [];
    const seenKeys = new Set<string>();
    for (const f of functions) {
      if (!f.label.trim()) continue;
      const key = (f.key.trim() || slugKey(f.label)).slice(0, 60);
      if (!key) continue;
      if (seenKeys.has(key)) {
        fnError = `Two functions share the key "${key}". Function keys must be unique.`;
        break;
      }
      seenKeys.add(key);
      let input: Record<string, unknown> | undefined;
      let output: Record<string, unknown> | undefined;
      try {
        input = f.inJson.trim() ? JSON.parse(f.inJson) : undefined;
        output = f.outJson.trim() ? JSON.parse(f.outJson) : undefined;
      } catch {
        fnError = `The input/deliverable of "${f.label}" is not valid JSON.`;
        break;
      }
      const amt = Number(f.amount);
      if (f.pricingModel !== 'free' && (!Number.isFinite(amt) || amt <= 0)) {
        fnError = `"${f.label}" is paid, so it needs a positive amount.`;
        break;
      }
      const pricing =
        f.pricingModel === 'free'
          ? { model: 'free' as const }
          : {
              model: f.pricingModel,
              amount: amt,
              currency: 'USDC' as const,
              ...(f.pricingModel === 'per_usage' && f.unit.trim() ? { unit: f.unit.trim() } : {}),
              ...(f.pricingModel === 'subscription' ? { period: f.period } : {}),
            };
      functionsOut.push({
        key,
        label: f.label.trim(),
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
        ...(f.requires.length ? { requires: f.requires } : {}),
        pricing,
        tier: f.tier,
      });
    }
    if (fnError) {
      setJsonErr(fnError);
      return null;
    }
    if (mode === 'multi' && functionsOut.length === 0) {
      setJsonErr('Add at least one function (each needs a name).');
      return null;
    }
    // Every requirement a function references must exist in the catalog.
    const catalogKeys = new Set(prerequisites.map((p) => p.key));
    for (const f of functionsOut) {
      const missing = (f.requires ?? []).find((k) => !catalogKeys.has(k));
      if (missing) {
        setJsonErr(`Function "${f.label}" needs requirement "${missing}", which is not declared.`);
        return null;
      }
    }
    const contactLinks = Object.fromEntries(
      Object.entries(contact)
        .map(([k, v]) => [k, (v ?? '').trim()])
        .filter(([, v]) => v),
    ) as ContactLinks;

    // In MULTI mode the service-level fields (DB non-null + legacy consumers) are
    // derived from the functions: the entry price, the first function's tier/io, and
    // its keys as capabilities. In SINGLE mode the top-level fields describe the one op.
    const tierMethod = (t: string) => (t === 'T2' ? 'attest' : t === 'T3' ? 'manual' : 'onchain');
    if (mode === 'multi') {
      const amounts = functionsOut.map((f) =>
        f.pricing.model === 'free' ? 0 : (f.pricing.amount ?? 0),
      );
      const first = functionsOut[0];
      return {
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        capabilities: functionsOut.map((f) => f.key),
        pricingModel,
        pricePerCall: Math.min(...amounts),
        endpoint: endpoint.trim(),
        stellarAddress: address.trim(),
        tier: first.tier ?? 'T2',
        verification: { method: tierMethod(first.tier ?? 'T2') },
        ...(first.input ? { inputSchema: first.input as Record<string, unknown> } : {}),
        ...(first.output ? { outputSchema: first.output as Record<string, unknown> } : {}),
        interaction: metered ? 'metered' : interaction,
        paymentModel,
        ...(attachmentsIn ? { attachmentsIn } : {}),
        ...(prerequisites.length ? { prerequisites } : {}),
        functions: functionsOut,
        ...(Object.keys(contactLinks).length ? { contactLinks } : {}),
      ...(ownerOrgId || edit ? { ownerOrgId } : {}),
      };
    }
    return {
      name: name.trim(),
      description: description.trim(),
      category: category.trim() || undefined,
      capabilities: capability.trim() ? [capability.trim()] : undefined,
      pricingModel,
      pricePerCall: Number(price),
      endpoint: endpoint.trim(),
      stellarAddress: address.trim(),
      tier,
      verification: { method, spec },
      inputSchema,
      outputSchema,
      interaction: metered ? 'metered' : interaction,
      paymentModel,
      ...(attachmentsIn ? { attachmentsIn } : {}),
      ...(prerequisites.length ? { prerequisites } : {}),
      ...(Object.keys(contactLinks).length ? { contactLinks } : {}),
      ...(ownerOrgId || edit ? { ownerOrgId } : {}),
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
      {edit ? (
        <p className="text-xs leading-relaxed text-slate-400">
          Editing <span className="text-slate-200">{edit.name}</span>. Changes re-anchor the
          service manifest; its trust history and settlements carry over. The pricing model
          (escrow vs metered scheme) is fixed at registration.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-slate-400">
          Your service lists immediately as <span className="text-slate-300">New</span> and earns a{' '}
          <span className="text-emerald-300">Trusted</span> tier as it settles real jobs on-chain.
          Buyers pay you from their vault under a private, policy-bounded release, you are never given
          their key or their rule.
        </p>
      )}
      <Section title="Service basics" required>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GitHub Tool"
              className={controls.field}
            />
          </Field>
          <Field label="Category">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Developer Tools"
              className={controls.field}
            />
          </Field>
        </div>
        <Field label="What it does" required hint="One line a buyer sees in the marketplace.">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what your service does"
            className={controls.field}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Endpoint URL"
            required
            error={endpoint.trim() && !endpointOk ? 'Must be a valid http(s) URL.' : null}
          >
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-service.example.com"
              className={controls.field}
            />
          </Field>
          <Field
            label="Stellar payout address"
            required
            hint="Receives USDC on settlement (needs a USDC trustline)."
            error={
              address.trim() && !addressOk
                ? 'Must be a valid Stellar public key (G…, 56 chars).'
                : null
            }
          >
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="G…"
              className={`${controls.field} font-mono`}
            />
          </Field>
        </div>
        <OwnerSelect value={ownerOrgId} onChange={setOwnerOrgId} orgs={myOrgs} />
      </Section>

      <Section title="How buyers pay & interact">
        <Field label="Payment model" hint={edit ? 'Fixed at registration.' : undefined}>
          <select
            value={paymentModel}
            onChange={(e) =>
              setPaymentModel(e.target.value as 'escrow' | 'x402' | 'mpp-session' | 'subscription')
            }
            className={controls.field}
            aria-label="Payment model"
            disabled={!!edit}
          >
            <option value="escrow">Escrow (pay on delivery)</option>
            <option value="x402">Pay-per-call (x402)</option>
            <option value="mpp-session">Streaming (MPP session)</option>
            <option value="subscription">Subscription</option>
          </select>
        </Field>
        {paymentModel === 'escrow' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Interaction">
                <select
                  value={interaction}
                  onChange={(e) => setInteraction(e.target.value as 'sync' | 'async' | 'human')}
                  className={controls.field}
                  aria-label="Interaction shape"
                >
                  <option value="sync">Instant (one request, one response)</option>
                  <option value="async">Long-running (the job runs, then completes)</option>
                  <option value="human">Human (a person does or approves the work)</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 pt-6 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={needsFile}
                  onChange={(e) => setNeedsFile(e.target.checked)}
                />
                Requires an input file
              </label>
            </div>
            {needsFile && (
              <Field label="Accepted file types">
                <input
                  value={accept}
                  onChange={(e) => setAccept(e.target.value)}
                  placeholder="e.g. application/pdf, image/*"
                  className={controls.field}
                />
              </Field>
            )}
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-500">
            Metered: buyers pay your endpoint per use from their agent wallet (not an escrowed job).
            Make sure your endpoint settles the chosen scheme.
          </p>
        )}
      </Section>

      <Section title="Requirements catalog">
        <p className="text-[11px] leading-relaxed text-slate-500">
          What a buyer must set up before hiring, that a prompt cannot carry: an API
          key/token, an install or authorization (with a link), or setup info. Declare them
          here, then attach each to the functions that need it, so a buyer is gated only on
          the functions whose requirements are unmet and can still use the rest. The agent
          checks before hiring and asks the buyer to complete any missing ones; satisfied
          values are sent to your endpoint as <code>credentials</code> (a secret is encrypted
          and never shown to the buyer again).
        </p>
        {prereqs.map((p, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-2.5">
            <div className="flex gap-1.5">
              <select
                value={p.kind}
                onChange={(e) => {
                  const kind = e.target.value as Prerequisite['kind'];
                  updatePrereq(i, { kind, secret: kind === 'apiKey' });
                }}
                className={controls.field}
                aria-label="Requirement type"
              >
                <option value="info">Info</option>
                <option value="apiKey">API key / token</option>
                <option value="install">Install / connect</option>
                <option value="oauth">Authorization</option>
              </select>
              <input
                value={p.key}
                onChange={(e) => updatePrereq(i, { key: e.target.value })}
                placeholder="key (e.g. github_token)"
                className={`${controls.field} font-mono`}
                aria-label="Requirement key"
              />
              <button
                type="button"
                onClick={() => removePrereq(i)}
                className="shrink-0 rounded-lg px-2 text-xs text-slate-500 hover:text-red-300"
              >
                Remove
              </button>
            </div>
            <input
              value={p.label}
              onChange={(e) => updatePrereq(i, { label: e.target.value })}
              placeholder="Label (e.g. GitHub access token)"
              className={controls.field}
              aria-label="Requirement label"
            />
            <input
              value={p.instructions}
              onChange={(e) => updatePrereq(i, { instructions: e.target.value })}
              placeholder="Instructions for the buyer (what to do / where to get it)"
              className={controls.field}
              aria-label="Requirement instructions"
            />
            {(p.kind === 'install' || p.kind === 'oauth') && (
              <input
                value={p.url ?? ''}
                onChange={(e) => updatePrereq(i, { url: e.target.value })}
                placeholder="Setup link, e.g. https://github.com/apps/your-app/installations/new"
                className={controls.field}
                aria-label="Requirement setup URL"
              />
            )}
            {p.kind === 'apiKey' && (
              <p className="text-[10px] text-slate-500">
                Stored encrypted; sent to your endpoint, never shown to the buyer again.
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addPrereq}
          className="text-xs font-medium text-violet-300 hover:text-violet-200"
        >
          + Add requirement
        </button>
      </Section>

      <Section
        title="What this service does"
        required
        hint="One operation if it does a single thing, or several functions each with its own input, deliverable, price, and requirements."
      >
        <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5 text-xs">
          {(['single', 'multi'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => chooseMode(m)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === m ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'single' ? 'One operation' : 'Multiple functions'}
            </button>
          ))}
        </div>

        {mode === 'single' ? (
          <div className="space-y-3">
            <Field
              label="Action key"
              hint="The exact action the worker sends to your endpoint; leave blank if your endpoint always does the same thing."
            >
              <input
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                placeholder="e.g. image.transform"
                className={`${controls.field} font-mono`}
              />
            </Field>
            <Field
              label="Price per call (USDC)"
              required
              error={!priceOk ? 'Enter a non-negative number.' : null}
            >
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 0.02"
                className={controls.field}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="How delivery is verified"
                hint="T1 trustless re-check, T2 result shape + dispute, T3 your approval."
              >
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value as 'T1' | 'T2' | 'T3')}
                  className={controls.field}
                  aria-label="Verification tier"
                >
                  <option value="T1">T1 Verifiable (trustless)</option>
                  <option value="T2">T2 Attestable (schema + dispute)</option>
                  <option value="T3">T3 Human (approval)</option>
                </select>
              </Field>
              {tier === 'T1' && (
                <Field label="Verification method">
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
                </Field>
              )}
            </div>
            <details className="text-xs text-slate-400" open={!!edit}>
              <summary className="cursor-pointer select-none text-slate-300">
                Input spec, deliverable format + verifier (optional)
              </summary>
              <div className="mt-2 space-y-3">
                <Field label="Input the agent provides">
                  <SchemaBuilder value={inJson} onChange={setInJson} addLabel="+ Add input field" />
                </Field>
                <Field label="Deliverable it returns">
                  <SchemaBuilder value={outJson} onChange={setOutJson} addLabel="+ Add result field" />
                </Field>
                <Field label="Verifier spec (for T1)">
                  <textarea
                    value={specJson}
                    onChange={(e) => setSpecJson(e.target.value)}
                    placeholder={'e.g. {"predicate":"sha256"} or {"signerKey":"G..."}'}
                    className={`${controls.field} font-mono`}
                    rows={2}
                  />
                </Field>
              </div>
            </details>
          </div>
        ) : (
          <FunctionsEditor
            functions={functions}
            setFunctions={setFunctions}
            requirements={prereqs}
          />
        )}
        {jsonErr && <p className="text-xs text-rose-400">{jsonErr}</p>}
      </Section>

      <Section
        title="Contact & links"
        hint="Who lists this and how to reach them. Shown on the service page so a buyer can see the owner, read the docs, and get support before granting any access."
      >
        <ContactLinksEditor value={contact} onChange={setContact} />
      </Section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!canSubmit} className={controls.primary}>
          {edit
            ? reg.isPending
              ? 'Saving…'
              : 'Save changes'
            : reg.isPending
              ? 'Registering…'
              : 'Register service'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-slate-400 hover:text-white">
          Cancel
        </button>
        {reg.error && (
          <span className="text-sm text-red-400">
            {edit ? 'Could not save changes.' : 'Could not register.'}
          </span>
        )}
      </div>
    </form>
  );
}

function ServicesCard() {
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState<ProviderServiceItem | null>(null);
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
          <button
            onClick={() => {
              setEditing(null);
              setRegistering((v) => !v);
            }}
            className={controls.chip}
          >
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
        {(registering || editing) && (
          <RegisterForm
            key={editing?.id ?? 'new'}
            edit={editing}
            onDone={() => {
              setRegistering(false);
              setEditing(null);
            }}
          />
        )}
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
                      {paymentModelLabel(s.paymentModel) && (
                        <span className="text-violet-300">{paymentModelLabel(s.paymentModel)}</span>
                      )}
                      {interactionLabel(s.interaction) && (
                        <span className="text-sky-300">{interactionLabel(s.interaction)}</span>
                      )}
                      {s.requiresFile && <span className="text-amber-300">needs file</span>}
                      {(s.functions?.length ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-slate-300"
                          title={s
                            .functions!.map((f) => `${f.label} - ${pricingLabel(f.pricing)}`)
                            .join('\n')}
                        >
                          <Boxes size={11} /> {s.functions!.length} functions
                        </span>
                      )}
                      {(s.prerequisites?.length ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-amber-200"
                          title={`Buyers must set up before hiring: ${s.prerequisites!
                            .map((p) => p.label)
                            .join(', ')}`}
                        >
                          <KeyRound size={11} /> {s.prerequisites!.length} setup req
                        </span>
                      )}
                      {s.inputSchema && (
                        <span
                          className="inline-flex items-center gap-1 text-slate-400"
                          title="An input spec is declared; agents fill it when hiring."
                        >
                          <FileInput size={11} /> input spec
                        </span>
                      )}
                      {s.outputSchema && (
                        <span
                          className="inline-flex items-center gap-1 text-slate-400"
                          title="A deliverable format is declared for your result."
                        >
                          <FileOutput size={11} /> deliverable spec
                        </span>
                      )}
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
                      {!s.healthy && (
                        <span
                          className="font-semibold text-red-400"
                          title="This service's /health endpoint is failing, so it is hidden from the marketplace until it responds again. Fix the endpoint; it relists automatically."
                        >
                          ⚠ endpoint unhealthy (hidden from directory)
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
                      onClick={() => {
                        setRegistering(false);
                        setEditing(s);
                      }}
                      className={`${controls.chip} shrink-0`}
                      title="Edit this service"
                    >
                      <Pencil size={13} /> Edit
                    </button>
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
      <Performance />

      <div className="grid gap-6 lg:grid-cols-2">
        <ServicesCard />
        <JobsCard />
      </div>
      <PayoutsCard />
      <DisputesCard />
    </section>
  );
}

/**
 * Aggregate performance across the provider's services, from real settled-job
 * reputation counts. Hidden until there is at least one real job, so a new provider
 * never sees a wall of zeros (honest: nothing to show yet).
 */
function Performance() {
  const { data: m, isLoading } = useQuery({
    queryKey: ['provider-metrics'],
    queryFn: getProviderMetrics,
  });
  const cell = (label: string, value: string, tone = 'text-slate-200') => (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
  if (isLoading) {
    return (
      <Card className="p-5">
        <Loading rows={2} />
      </Card>
    );
  }
  if (!m || m.totalJobs === 0) return null;
  return (
    <Card className="p-0">
      <CardHeader
        icon={Activity}
        title="Performance"
        hint="Real rates from settled on-chain jobs across your services."
      />
      <div className="grid grid-cols-2 gap-3 p-5 pt-4 sm:grid-cols-3 lg:grid-cols-6">
        {cell('Jobs', String(m.totalJobs))}
        {cell(
          'Success',
          `${m.successRate}%`,
          m.successRate >= 90
            ? 'text-emerald-300'
            : m.successRate >= 70
              ? 'text-amber-300'
              : 'text-red-400',
        )}
        {cell('Avg latency', m.avgLatencyMs ? `${m.avgLatencyMs}ms` : 'n/a')}
        {cell(
          'Disputes upheld',
          `${m.disputeRate}%`,
          m.disputeRate > 5 ? 'text-red-400' : 'text-slate-200',
        )}
        {cell('Unique payers', String(m.uniquePayers))}
        {cell('Active services', `${m.activeServices}/${m.services}`)}
      </div>
    </Card>
  );
}

/**
 * The provider's payout ledger: every payment to their services (settled + pending),
 * each verifiable on-chain, with a client-side CSV export for accounting. Amounts are
 * the real on-chain payments as recorded; the protocol fee rate is disclosed in Stats.
 */
function PayoutsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['provider-payouts'],
    queryFn: getProviderPayouts,
  });
  const items = data?.items ?? [];
  const download = () => {
    const blob = new Blob([payoutsToCsv(items)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clevercon-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card className="p-0">
      <CardHeader
        icon={Receipt}
        title="Payouts"
        hint="Every payment to your services, verifiable on-chain. Export for accounting."
      />
      <div className="p-5 pt-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-lg font-bold text-emerald-300">
              ${(data?.settledTotal ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">Settled</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-300">
              ${(data?.pendingTotal ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">Pending</div>
          </div>
          <button
            type="button"
            onClick={download}
            disabled={items.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={13} /> Download CSV
          </button>
        </div>
        {isLoading ? (
          <div className="mt-4">
            <Loading rows={3} />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4">
            <EmptyState>No payouts yet. They appear here once buyers hire and settle.</EmptyState>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Service</th>
                  <th className="pb-2 pr-3 font-medium">Amount</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 50).map((p) => (
                  <tr key={p.id} className="border-t border-white/[0.04]">
                    <td className="py-2 pr-3 text-slate-400">{when(p.createdAt)}</td>
                    <td className="max-w-[12rem] truncate py-2 pr-3 text-slate-300">{p.service}</td>
                    <td className="cc-num py-2 pr-3 text-slate-200">
                      ${p.amount.toFixed(2)} {p.asset}
                    </td>
                    <td
                      className={`py-2 pr-3 text-xs ${
                        p.status === 'CONFIRMED'
                          ? 'text-emerald-300'
                          : p.status === 'FAILED'
                            ? 'text-red-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {p.status}
                    </td>
                    <td className="py-2 text-xs">
                      {p.txHash ? (
                        <a
                          href={explorerTx(p.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
                        >
                          {p.txHash.slice(0, 8)}… <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > 50 && (
              <p className="mt-2 text-xs text-slate-500">
                Showing 50 of {items.length}. Download CSV for the full ledger.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
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
