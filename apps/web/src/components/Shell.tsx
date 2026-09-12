import type { ComponentType, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Layers, ShoppingBag, Store, ShieldCheck, Terminal } from 'lucide-react';
import { useSession, type Role } from '../store/session';
import { useWalletAuth } from '../auth/useWalletAuth';
import { DemoBanner } from './DemoBanner';
import { config } from '../config';

type Icon = ComponentType<{ size?: number; className?: string }>;

// Which Stellar network the app is pointed at. Testnet is amber (test funds, no
// real value); mainnet is emerald (live). Driven by config, not hardcoded.
const NETWORKS: Record<string, { label: string; dot: string; text: string; border: string }> = {
  testnet: {
    label: 'Stellar testnet',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    border: 'border-amber-500/25',
  },
  mainnet: {
    label: 'Stellar mainnet',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    border: 'border-emerald-500/25',
  },
  local: {
    label: 'Local',
    dot: 'bg-slate-400',
    text: 'text-slate-400',
    border: 'border-white/10',
  },
};

/** The active-network badge, shown across the app so the network is never ambiguous. */
function NetworkBadge({ className = '' }: { className?: string }) {
  const net = NETWORKS[config.network] ?? NETWORKS.testnet;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-white/[0.03] px-2.5 py-1 text-[11px] ${net.border} ${net.text} ${className}`}
      title={`This app is operating against ${net.label}.`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${net.dot}`} /> {net.label}
    </span>
  );
}

// `selfServe` links are shown to any signed-in user (the console itself is the
// place you acquire the role); the rest appear only once the role is held.
const NAV: { to: string; label: string; role: Role; icon: Icon; selfServe?: boolean }[] = [
  { to: '/app', label: 'Buyer', role: 'BUYER', icon: ShoppingBag },
  { to: '/provider', label: 'Provider', role: 'PROVIDER', icon: Store, selfServe: true },
  { to: '/admin', label: 'Admin', role: 'ADMIN', icon: ShieldCheck },
  { to: '/developers', label: 'Developer', role: 'DEVELOPER', icon: Terminal, selfServe: true },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 shadow-lg shadow-violet-900/40">
        <Layers size={16} className="text-white" />
      </div>
      {!compact && (
        <span className="text-[15px] font-bold tracking-tight text-white">CleverCon</span>
      )}
    </Link>
  );
}

function WalletButton({ full = false }: { full?: boolean }) {
  const session = useSession((s) => s.session);
  const { disconnect } = useWalletAuth();
  if (session) {
    return (
      <button
        onClick={disconnect}
        className={`rounded-lg bg-white/[0.06] px-3 py-2 font-mono text-xs text-slate-300 hover:bg-white/10 transition-colors ${full ? 'w-full text-left' : ''}`}
      >
        {session.address.slice(0, 4)}…{session.address.slice(-4)}
        <span className="text-slate-500"> · Disconnect</span>
      </button>
    );
  }
  return (
    <Link
      to="/connect"
      className={`rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-violet-500 hover:to-indigo-500 transition-all ${full ? 'block text-center' : ''}`}
    >
      Connect
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession((s) => s.session);
  const loc = useLocation();
  const roles = session?.roles ?? [];

  // The landing page is a full-bleed marketing page with its own header/footer.
  if (loc.pathname === '/') return <>{children}</>;

  const items = NAV.filter((n) => roles.includes(n.role) || (n.selfServe && session));
  const isActive = (to: string) => loc.pathname === to || loc.pathname.startsWith(to + '/');

  return (
    <div className="min-h-screen bg-[#0b0d13] text-slate-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/5 bg-[#0c0e15] px-4 py-5 lg:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-600">
            Consoles
          </p>
          {items.map((n) => {
            const active = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-violet-500/10 text-white'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <n.icon size={16} className={active ? 'text-violet-300' : ''} />
                {n.label}
              </Link>
            );
          })}
          {items.length === 0 && (
            <p className="px-3 text-xs text-slate-600">Connect a wallet to begin.</p>
          )}
        </nav>
        <div className="mt-auto space-y-3">
          <NetworkBadge />
          <WalletButton full />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/5 bg-[#0b0d13]/85 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center gap-3">
          <NetworkBadge className="hidden sm:inline-flex" />
          {items.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={isActive(n.to) ? 'text-violet-300' : 'text-slate-400'}
              aria-label={n.label}
            >
              <n.icon size={18} />
            </Link>
          ))}
          <WalletButton />
        </div>
      </header>

      <div className="lg:pl-60">
        <DemoBanner />
        <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
