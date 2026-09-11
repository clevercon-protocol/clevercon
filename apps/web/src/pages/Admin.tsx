import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Boxes, Coins, Landmark, Briefcase, Percent } from 'lucide-react';
import { demoDisputes } from '../lib/demo';
import { getAdminStats, getAdminUsers, setUserRole, getFees, setFee } from '../lib/admin';

const MANAGEABLE_ROLES = ['PROVIDER', 'DEVELOPER', 'ADMIN'] as const;

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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
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
              <div className="text-lg font-bold">${fees.accruedUsdc.toFixed(2)}</div>
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
              className="min-w-56 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-500/40"
            />
            <button
              type="submit"
              disabled={bps === '' || save.isPending}
              className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {save.isPending ? 'Updating…' : 'Update fee'}
            </button>
          </form>
          {save.error && <p className="mt-2 text-sm text-red-400">Could not update the fee.</p>}
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
        <div key={t.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <t.icon size={16} className="text-violet-300" />
          <div className="mt-2 text-xl font-bold">{t.value}</div>
          <div className="text-xs text-slate-500">{t.label}</div>
        </div>
      ))}
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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Users &amp; roles</h2>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading users…</p>}
      {error && <p className="mt-4 text-sm text-red-400">Could not load users.</p>}
      {!isLoading && !error && users.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No users yet.</p>
      )}
      <div className="mt-4 space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs text-slate-400">
                {u.wallet ? `${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)}` : u.id.slice(0, 10)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {u.services} services · {u.tasks} tasks · {u.apiKeys} keys
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
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

export function Admin() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin console</h1>
        <p className="mt-1 text-slate-400">Monitoring, users and roles, and disputes.</p>
      </div>

      <StatTiles />
      <FeesCard />
      <UsersCard />

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-semibold text-slate-300">Disputes</h2>
        <p className="mt-1 text-xs text-slate-500">
          Dispute arbitration is on the roadmap; this is a preview.
        </p>
        <div className="mt-4 space-y-2">
          {demoDisputes.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div>
                <div className="font-medium">{d.task}</div>
                <div className="text-xs text-slate-500">{d.parties}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-300">${d.amountUsdc}</span>
                <span
                  className={`text-xs capitalize ${d.status === 'open' ? 'text-amber-300' : 'text-emerald-300'}`}
                >
                  {d.status}
                </span>
                <button
                  disabled
                  className="cursor-not-allowed rounded-lg bg-white/10 px-2.5 py-1 text-xs text-slate-400"
                >
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
