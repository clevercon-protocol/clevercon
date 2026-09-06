import { useMemo, useState } from 'react';
import { Wallet, Search, UserCheck, Workflow, Star } from 'lucide-react';
import { demoVault, demoServices, demoCategories } from '../lib/demo';

type Mode = 'direct' | 'search' | 'compose';

const MODES: { id: Mode; icon: typeof UserCheck; label: string; blurb: string }[] = [
  {
    id: 'direct',
    icon: UserCheck,
    label: 'Pay a provider',
    blurb: 'You already know who to hire, so it is one bounded, private payment.',
  },
  {
    id: 'search',
    icon: Search,
    label: 'Find & pay one',
    blurb: 'Describe what you need; pick from matching providers and pay.',
  },
  {
    id: 'compose',
    icon: Workflow,
    label: 'Compose a job',
    blurb: 'A multi-service job where a delegate plans steps and pays per step.',
  },
];

function VaultCard() {
  const rows: [string, number][] = [
    ['Balance', demoVault.balanceUsdc],
    ['Available', demoVault.availableUsdc],
    ['Locked', demoVault.lockedUsdc],
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-2 text-slate-300">
        <Wallet size={18} className="text-violet-300" />
        <h2 className="font-semibold">Your vault</h2>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {rows.map(([label, v]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center"
          >
            <div className="text-lg font-bold">${v.toFixed(2)}</div>
            <div className="text-xs text-slate-500">{label} USDC</div>
          </div>
        ))}
      </div>
      <button
        disabled
        title="Connect a wallet in full mode to deposit"
        className="mt-4 w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-slate-400 cursor-not-allowed"
      >
        Deposit (demo)
      </button>
    </div>
  );
}

function HirePanel() {
  const [mode, setMode] = useState<Mode>('direct');
  const active = MODES.find((m) => m.id === mode)!;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Hire a service</h2>
      <div className="mt-4 flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${mode === m.id ? 'border-violet-500/40 bg-violet-500/10 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}
          >
            <m.icon size={16} className="mx-auto mb-1" />
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-400">{active.blurb}</p>
      <button
        disabled
        className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm text-slate-400 cursor-not-allowed"
      >
        Start (demo)
      </button>
    </div>
  );
}

function Marketplace() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  const results = useMemo(() => {
    return demoServices.filter(
      (s) =>
        (cat === 'All' || s.category === cat) &&
        (q === '' ||
          s.name.toLowerCase().includes(q.toLowerCase()) ||
          s.description.toLowerCase().includes(q.toLowerCase())),
    );
  }, [q, cat]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-semibold text-slate-300">Marketplace</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search services…"
          className="flex-1 min-w-48 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-500/40"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        >
          <option>All</option>
          {demoCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {results.map((s) => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                <Star size={12} /> {s.rating}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{s.description}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                {s.category} · {s.provider}
              </span>
              <span className="text-slate-300">${s.pricePerCall}/call</span>
            </div>
          </div>
        ))}
        {results.length === 0 && <p className="text-sm text-slate-500">No services match.</p>}
      </div>
    </div>
  );
}

export function Buyer() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Buyer console</h1>
        <p className="mt-1 text-slate-400">
          Fund a vault, hire services, and keep your spending rules private.
        </p>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <VaultCard />
        <HirePanel />
      </div>
      <Marketplace />
    </section>
  );
}
