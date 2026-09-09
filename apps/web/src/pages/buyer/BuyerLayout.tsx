import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Vault, Search, ListChecks, ShieldCheck } from 'lucide-react';

const TABS = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/vault', label: 'Vault', icon: Vault },
  { to: '/app/marketplace', label: 'Marketplace', icon: Search },
  { to: '/app/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/app/policies', label: 'Policies', icon: ShieldCheck },
];

export function BuyerLayout() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Buyer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Fund a vault, hire services, and keep your spending rules private.
        </p>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-violet-500/15 text-white'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
              }`
            }
          >
            <t.icon size={15} />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </section>
  );
}
