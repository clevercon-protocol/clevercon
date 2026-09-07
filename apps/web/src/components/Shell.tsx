import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession, type Role } from '../store/session';
import { useWalletAuth } from '../auth/useWalletAuth';
import { DemoBanner } from './DemoBanner';

// `selfServe` links are shown to any signed-in user (the console itself is the
// place you acquire the role); the rest appear only once the role is held.
const NAV: { to: string; label: string; role: Role; selfServe?: boolean }[] = [
  { to: '/app', label: 'Buyer', role: 'BUYER' },
  { to: '/provider', label: 'Provider', role: 'PROVIDER' },
  { to: '/admin', label: 'Admin', role: 'ADMIN' },
  { to: '/developers', label: 'Developer', role: 'DEVELOPER', selfServe: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession((s) => s.session);
  const { disconnect } = useWalletAuth();
  const loc = useLocation();
  const roles = session?.roles ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <DemoBanner />
      <header className="border-b border-white/10">
        <nav className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-bold tracking-tight">
            CleverCon
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {NAV.filter((n) => roles.includes(n.role) || (n.selfServe && session)).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={
                  loc.pathname.startsWith(n.to)
                    ? 'text-violet-300'
                    : 'text-slate-400 hover:text-white'
                }
              >
                {n.label}
              </Link>
            ))}
            {session ? (
              <button
                onClick={disconnect}
                className="rounded bg-white/10 hover:bg-white/20 px-3 py-1"
              >
                {session.address.slice(0, 4)}…{session.address.slice(-4)} · Disconnect
              </button>
            ) : (
              <Link
                to="/connect"
                className="rounded bg-violet-600 hover:bg-violet-500 px-3 py-1 font-medium"
              >
                Connect
              </Link>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
