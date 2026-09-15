import { NavLink, Outlet } from 'react-router-dom';
import { MessagesSquare, Vault, Search, Activity } from 'lucide-react';
import { useRealtime } from '../../lib/useRealtime';

// Chat-first: instruct your agent (Home), browse services it can pull from,
// see everything it did (Activity), and manage money + limits (Vault & setup).
const TABS = [
  { to: '/app', label: 'Home', icon: MessagesSquare, end: true },
  { to: '/app/services', label: 'Services', icon: Search },
  { to: '/app/activity', label: 'Activity', icon: Activity },
  { to: '/app/vault', label: 'Vault & setup', icon: Vault },
];

export function BuyerLayout() {
  useRealtime();
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Your agent</h1>
        <p className="mt-1 text-sm text-slate-400">
          Put an AI agent in charge of your money, within private limits it cannot break.
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
