import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Boxes,
  Coins,
  Landmark,
  Briefcase,
  Percent,
  Rocket,
  Building2,
  BadgeCheck,
} from 'lucide-react';
import {
  getAdminStats,
  getActivation,
  getAdminUsers,
  setUserRole,
  getFees,
  setFee,
  claimFees,
  getMarketplaceAnalytics,
  getAdminServices,
  moderateService,
  getDisputes,
  resolveDispute,
  getAdminOrgs,
  verifyOrg,
  verifyUser,
} from '../lib/admin';
import { Loading, ErrorState, controls } from '../components/ui';

function DisputesCard() {
  const qc = useQueryClient();
  const {
    data: disputes = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['admin-disputes'], queryFn: getDisputes });
  const act = useMutation({
    // On-chain settlement: the vault splits the still-locked remainder. "Refund
    // buyer" upholds the dispute and sends the budget back; "Reject" pays it to
    // the provider. (For a partial split, extend this to collect two amounts.)
    mutationFn: (v: { id: string; reject: boolean; budget: number }) =>
      resolveDispute(v.id, {
        resolution: v.reject ? 'Rejected by operator' : 'Refunded to buyer',
        upheld: !v.reject,
        refundToUser: v.reject ? 0 : v.budget,
        payoutToProvider: v.reject ? v.budget : 0,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-disputes'] }),
  });
  const open = disputes.filter((d) => d.status === 'OPEN');
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <h2 className="font-semibold text-slate-300">Disputes</h2>
      {isLoading && (
        <div className="mt-4">
          <Loading rows={2} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState>Could not load disputes.</ErrorState>
        </div>
      )}
      {!isLoading && !error && disputes.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No disputes.</p>
      )}
      <div className="mt-4 space-y-2">
        {disputes.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{d.taskTitle}</div>
              <div className="truncate text-xs text-slate-500">
                {d.raisedBy.slice(0, 6)}…{d.raisedBy.slice(-4)}
                {d.reason ? ` · ${d.reason}` : ''}
                {d.status !== 'OPEN' && d.resolution ? ` · ${d.resolution}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-300">${d.budget.toFixed(2)}</span>
              {d.status === 'OPEN' ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => act.mutate({ id: d.id, reject: false, budget: d.budget })}
                    disabled={act.isPending}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    Refund buyer
                  </button>
                  <button
                    onClick={() => act.mutate({ id: d.id, reject: true, budget: d.budget })}
                    disabled={act.isPending}
                    className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-400 hover:bg-white/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <span
                  className={`text-xs ${d.status === 'RESOLVED' ? 'text-emerald-300' : 'text-slate-500'}`}
                >
                  {d.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {open.length > 0 && <p className="mt-3 text-xs text-slate-500">{open.length} open</p>}
      {act.error && (
        <p className="mt-3 text-xs text-amber-300">
          {(act.error as Error).message || 'Could not settle the dispute on-chain.'}
        </p>
      )}
    </div>
  );
}

const MANAGEABLE_ROLES = ['PROVIDER', 'DEVELOPER', 'ADMIN'] as const;

function ServicesModerationCard() {
  const qc = useQueryClient();
  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['admin-services'], queryFn: getAdminServices });
  const moderate = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => moderateService(v.id, v.active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <h2 className="font-semibold text-slate-300">Services (moderation)</h2>
      {isLoading && (
        <div className="mt-4">
          <Loading rows={3} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState>Could not load services.</ErrorState>
        </div>
      )}
      {!isLoading && !error && services.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No services yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {services.map((s) => {
          const active = s.status === 'ACTIVE';
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {s.category ?? 'Uncategorised'} · ${s.pricePerCall}/call · {s.totalJobs} jobs
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs ${active ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {s.status}
                </span>
                <button
                  onClick={() => moderate.mutate({ id: s.id, active: !active })}
                  disabled={moderate.isPending}
                  className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {active ? 'Take down' : 'Restore'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeesCard() {
  const qc = useQueryClient();
  const { data: fees } = useQuery({ queryKey: ['admin-fees'], queryFn: getFees });
  const [bps, setBps] = useState('');
  const save = useMutation({
    mutationFn: () => setFee(Number(bps)),
    onSuccess: () => {
      setBps('');
      qc.invalidateQueries({ queryKey: ['admin-fees'] });
    },
  });
  const claim = useMutation({
    mutationFn: () => claimFees(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fees'] }),
  });

  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Percent size={16} className="text-violet-300" />
        <h2 className="font-semibold">Protocol fee</h2>
      </div>
      {!fees?.enabled ? (
        <p className="mt-3 text-sm text-slate-500">
          Fee administration is not configured in this environment.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Current fee</div>
              <div className="text-lg font-bold">{(fees.bps / 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Accrued</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">${fees.accruedUsdc.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => claim.mutate()}
                  disabled={fees.accruedUsdc <= 0 || claim.isPending}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  {claim.isPending ? 'Claiming…' : 'Claim'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Recipient</div>
              <div className="font-mono text-sm text-slate-300">
                {fees.recipient
                  ? `${fees.recipient.slice(0, 6)}…${fees.recipient.slice(-4)}`
                  : 'unset'}
              </div>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (bps !== '' && !save.isPending) save.mutate();
            }}
            className="mt-4 flex flex-wrap items-center gap-2"
          >
            <input
              value={bps}
              onChange={(e) => setBps(e.target.value)}
              inputMode="numeric"
              placeholder="New fee (bps, e.g. 30 = 0.30%)"
              className={`min-w-56 flex-1 ${controls.field}`}
            />
            <button
              type="submit"
              disabled={bps === '' || save.isPending}
              className={controls.primary}
            >
              {save.isPending ? 'Updating…' : 'Update fee'}
            </button>
          </form>
          {save.error && <p className="mt-2 text-sm text-red-400">Could not update the fee.</p>}
          {claim.error && (
            <p className="mt-2 text-xs text-amber-300">
              {(claim.error as Error).message || 'Could not claim fees.'} The vault requires the
              fee recipient to be the orchestrator key for console claims.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StatTiles() {
  const { data: s } = useQuery({ queryKey: ['admin-stats'], queryFn: getAdminStats });
  const tiles = [
    { icon: Users, label: 'Users', value: String(s?.users ?? 0) },
    { icon: Boxes, label: 'Active services', value: String(s?.activeServices ?? 0) },
    { icon: Briefcase, label: 'Tasks', value: String(s?.tasks ?? 0) },
    { icon: Coins, label: 'Paid volume', value: `$${(s?.paymentsVolumeUsdc ?? 0).toFixed(2)}` },
    { icon: Landmark, label: 'Value locked', value: `$${(s?.tvlUsdc ?? 0).toFixed(2)}` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl bg-white/[0.04] p-4">
          <t.icon size={16} className="text-violet-300" />
          <div className="mt-2 text-xl font-bold">{t.value}</div>
          <div className="text-xs text-slate-500">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function ActivationFunnelCard() {
  const { data } = useQuery({ queryKey: ['admin-activation'], queryFn: getActivation });
  const steps = data?.steps ?? [];
  const top = steps[0]?.count ?? 0;
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Rocket size={18} className="text-violet-300" />
        <h2 className="font-semibold">Activation funnel</h2>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        How many users reached each step of the core path. First-party and aggregate, no external
        analytics.
      </p>
      <div className="mt-4 space-y-2">
        {steps.map((s) => {
          const pct = top > 0 ? Math.round((s.count / top) * 100) : 0;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{s.label}</span>
                <span className="text-slate-400">
                  {s.count}
                  <span className="ml-1 text-xs text-slate-600">({pct}%)</span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        {steps.length === 0 && <p className="text-sm text-slate-500">No activation data yet.</p>}
      </div>
    </div>
  );
}

function UsersCard() {
  const qc = useQueryClient();
  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
  });
  const toggle = useMutation({
    mutationFn: (v: { userId: string; role: string; grant: boolean }) =>
      setUserRole(v.userId, v.role, v.grant),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
  const verify = useMutation({
    mutationFn: (v: { userId: string; verified: boolean }) => verifyUser(v.userId, v.verified),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });

  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <h2 className="font-semibold text-slate-300">Users &amp; roles</h2>
      {isLoading && (
        <div className="mt-4">
          <Loading rows={3} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState>Could not load users.</ErrorState>
        </div>
      )}
      {!isLoading && !error && users.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No users yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {u.displayName && <span className="text-slate-200">{u.displayName}</span>}
                {u.handle && <span className="text-xs text-slate-500">@{u.handle}</span>}
                {u.verified && <BadgeCheck size={13} className="text-sky-300" />}
              </div>
              <div className="font-mono text-xs text-slate-400">
                {u.wallet ? `${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)}` : u.id.slice(0, 10)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {u.services} services · {u.tasks} tasks · {u.apiKeys} keys
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => verify.mutate({ userId: u.id, verified: !u.verified })}
                disabled={verify.isPending}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  u.verified
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                    : 'border-white/10 text-slate-500 hover:text-white'
                }`}
                title={u.verified ? 'Revoke verified' : 'Grant verified'}
              >
                <BadgeCheck size={12} /> Verified
              </button>
              {MANAGEABLE_ROLES.map((role) => {
                const has = u.roles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggle.mutate({ userId: u.id, role, grant: !has })}
                    disabled={toggle.isPending}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                      has
                        ? 'border-violet-500/40 bg-violet-500/15 text-white'
                        : 'border-white/10 text-slate-500 hover:text-white'
                    }`}
                    title={has ? `Revoke ${role}` : `Grant ${role}`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrgsCard() {
  const qc = useQueryClient();
  const {
    data: orgs = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['admin-orgs'], queryFn: getAdminOrgs });
  const verify = useMutation({
    mutationFn: (v: { id: string; verified: boolean }) => verifyOrg(v.id, v.verified),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2">
        <Building2 size={16} className="text-violet-300" />
        <h2 className="font-semibold text-slate-300">Organizations</h2>
      </div>
      {isLoading && (
        <div className="mt-4">
          <Loading rows={2} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState>Could not load organizations.</ErrorState>
        </div>
      )}
      {!isLoading && !error && orgs.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No organizations yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {orgs.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-slate-200">{o.name}</span>
                <span className="text-xs text-slate-500">@{o.handle}</span>
                {o.verified && <BadgeCheck size={13} className="text-sky-300" />}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {o.services} services · {o.members} members
              </div>
            </div>
            <button
              onClick={() => verify.mutate({ id: o.id, verified: !o.verified })}
              disabled={verify.isPending}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                o.verified
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 text-slate-500 hover:text-white'
              }`}
              title={o.verified ? 'Revoke verified' : 'Grant verified'}
            >
              <BadgeCheck size={12} /> {o.verified ? 'Verified' : 'Verify'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketplaceAnalyticsCard() {
  const { data } = useQuery({
    queryKey: ['admin-marketplace'],
    queryFn: getMarketplaceAnalytics,
  });
  if (!data) return null;
  const topCat = data.byCategory[0]?.services ?? 0;
  return (
    <div className="rounded-2xl bg-white/[0.04] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Boxes size={18} className="text-violet-300" />
        <h2 className="font-semibold">Marketplace</h2>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Active services', String(data.activeServices)],
          ['Settled jobs', String(data.settledJobs)],
          ['GMV', `$${data.gmvUsdc.toFixed(2)}`],
          ['Tiers', data.byTier.map((t) => `${t.tier}:${t.services}`).join('  ') || '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white/[0.04] p-3">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>
      {data.topServices.length > 0 && (
        <div className="mt-5">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Top services by settled volume
          </div>
          <div className="mt-2 space-y-2">
            {data.topServices.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-300">
                  {s.name} <span className="text-xs text-slate-600">{s.tier}</span>
                </span>
                <span className="shrink-0 text-slate-400">
                  {s.settlements} jobs
                  <span className="ml-1 text-xs text-slate-600">· {s.score.toFixed(1)}★</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.byCategory.length > 0 && (
        <div className="mt-5">
          <div className="text-xs uppercase tracking-wider text-slate-500">By category</div>
          <div className="mt-2 space-y-1.5">
            {data.byCategory.map((c) => {
              const pct = topCat > 0 ? Math.round((c.services / topCat) * 100) : 0;
              return (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">{c.category}</span>
                    <span className="text-slate-400">{c.services}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Admin() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin console</h1>
        <p className="mt-1 text-slate-400">Monitoring, users and roles, and disputes.</p>
      </div>

      <StatTiles />
      <MarketplaceAnalyticsCard />
      <ActivationFunnelCard />
      <FeesCard />
      <ServicesModerationCard />
      <OrgsCard />
      <UsersCard />
      <DisputesCard />
    </section>
  );
}
