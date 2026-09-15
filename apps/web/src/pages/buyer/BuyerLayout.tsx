import { NavLink, Outlet } from 'react-router-dom';
import { MessagesSquare, Vault, Search, Activity, SlidersHorizontal } from 'lucide-react';
import { useRealtime } from '../../lib/useRealtime';
import { PageHeader } from '../../components/ui';

// Chat-first: instruct your agent (Home), define the rules it must obey (Limits),
// browse services it can pull from (Services), see everything it did (Activity),
// and manage the money + accounts (Vault). Each concept gets its own focused tab.
const TABS = [
  { to: '/app', label: 'Home', icon: MessagesSquare, end: true },
  { to: '/app/limits', label: 'Limits', icon: SlidersHorizontal },
  { to: '/app/services', label: 'Services', icon: Search },
  { to: '/app/activity', label: 'Activity', icon: Activity },
  { to: '/app/vault', label: 'Vault', icon: Vault },
];

export function BuyerLayout() {
  useRealtime();
  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Spending agent"
        title="Your agent"
        subtitle="Put an AI agent in charge of your money, within private limits it cannot break."
      />

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-violet-500/[0.16] text-white shadow-sm shadow-violet-950/30'
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
