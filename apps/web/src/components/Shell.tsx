import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useSession, type Role } from '../store/session';
import { useWalletAuth } from '../auth/useWalletAuth';
import { DemoBanner } from './DemoBanner';

// `selfServe` links are shown to any signed-in user (the console itself is the
// place you acquire the role); the rest appear only once the role is held.
const NAV: { to: string; label: string; role: Role; selfServe?: boolean }[] = [
  { to: '/app', label: 'Buyer', role: 'BUYER' },
  { to: '/provider', label: 'Provider', role: 'PROVIDER', selfServe: true },
  { to: '/admin', label: 'Admin', role: 'ADMIN' },
  { to: '/developers', label: 'Developer', role: 'DEVELOPER', selfServe: true },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-violet-900/40">
        <Layers size={16} className="text-white" />
      </div>
      <span className="text-[15px] font-bold tracking-tight text-white">CleverCon</span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession((s) => s.session);
  const { disconnect } = useWalletAuth();
  const loc = useLocation();
  const roles = session?.roles ?? [];

  // The landing page is a full-bleed marketing page with its own header/footer.
  if (loc.pathname === '/') return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#0b0d13] text-slate-100">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0b0d13]/85 backdrop-blur">
        <nav className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4 text-sm">
            {NAV.filter((n) => roles.includes(n.role) || (n.selfServe && session)).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={
                  loc.pathname.startsWith(n.to)
                    ? 'text-violet-300'
                    : 'text-slate-400 hover:text-white transition-colors'
                }
              >
                {n.label}
              </Link>
            ))}
            {session ? (
              <button
                onClick={disconnect}
                className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 font-mono text-xs transition-colors"
              >
                {session.address.slice(0, 4)}…{session.address.slice(-4)} · Disconnect
              </button>
            ) : (
              <Link
                to="/connect"
                className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-4 py-1.5 font-medium transition-all"
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
