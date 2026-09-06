import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Shield, Store, Boxes, Github, ArrowRight, Wallet, Eye, Zap,
  Layers, CheckCircle2, ExternalLink, Sparkles,
  Search, Workflow, UserCheck, EyeOff, Fingerprint,
} from 'lucide-react';

// Update these with real handles as they go live. Entries with an empty url are
// not rendered.
const SOCIALS = [
  { label: 'GitHub', url: 'https://github.com/clevercon-protocol/clevercon', icon: Github },
  { label: 'X', url: '', icon: null },
  { label: 'Discord', url: '', icon: null },
];
const GITHUB_URL = 'https://github.com/clevercon-protocol/clevercon';
const CIPHERMIT_URL = 'https://github.com/Bosun-Josh121/ciphermit';

/** Fade-and-rise on scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { el.classList.add('cc-in'); io.unobserve(el); }
      }),
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`cc-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-violet-900/40">
        <Layers size={16} className="text-white" />
      </div>
      <span className="text-[15px] font-bold tracking-tight text-white">CleverCon</span>
    </div>
  );
}

const PILLARS = [
  {
    icon: Shield, tint: 'from-violet-500/20 to-transparent', ring: 'text-violet-300', border: 'border-violet-800/40',
    tag: 'The differentiator',
    title: 'Private by design',
    body: 'Spending rules are enforced on-chain but never revealed. Your budget, approved payees, and payment history stay yours, proven with zero-knowledge, not broadcast to a public ledger.',
  },
  {
    icon: Store, tint: 'from-cyan-500/20 to-transparent', ring: 'text-cyan-300', border: 'border-cyan-800/40',
    tag: 'The live application',
    title: 'An open marketplace',
    body: 'Hire real services in USDC: AI agents, human specialists, and business services across seven categories. Fund a non-custodial vault, and the agent pays per step, always within your limit.',
  },
  {
    icon: Boxes, tint: 'from-emerald-500/20 to-transparent', ring: 'text-emerald-300', border: 'border-emerald-800/40',
    tag: 'The reach',
    title: 'Build on it',
    body: 'A reusable SDK and a Stellar MCP server let any app or agent embed safe, private spending in a few calls. CleverCon is a rail others build on, not just a destination app.',
  },
];

const CATEGORIES = [
  'Data & Oracles', 'AI & Analysis', 'Web & Research', 'Finance & DeFi',
  'Risk & Compliance', 'Human Services', 'Business Services',
];

// CleverCon adapts to how much coordination a job needs. The rail is constant;
// planning is optional and only kicks in for genuinely multi-service work.
const USAGE_MODES = [
  {
    icon: UserCheck, title: 'Pay a provider you chose',
    body: 'Already know who you want? Point CleverCon at that service, set your rules, and it makes a single bounded, private payment. No planning, no matchmaking.',
  },
  {
    icon: Search, title: 'Find and pay one service',
    body: 'Describe what you need and the open registry returns matching providers by capability, price, and reputation. Pick one, or take the top-ranked, and pay.',
  },
  {
    icon: Workflow, title: 'Compose a multi-service job',
    body: 'For work that spans services, gather data, analyze it, write a report, a delegate plans the steps, hires a provider for each, and pays in sequence. Optional, and only when the job needs it.',
  },
];

type OfferStatus = 'live' | 'dev' | 'planned';
const OFFERINGS: { icon: typeof Wallet; name: string; status: OfferStatus; body: string }[] = [
  { icon: Wallet, name: 'Non-custodial vault', status: 'live', body: 'Fund a Soroban contract and spend under a budget it enforces. The platform never holds your money.' },
  { icon: Store, name: 'Services marketplace', status: 'live', body: 'Hire AI agents, human specialists, and business services, paid in USDC over x402 and MPP.' },
  { icon: Shield, name: 'Private spending policies', status: 'dev', body: 'Spending rules enforced on-chain but kept private, with proof of compliance. Built on zero-knowledge.' },
  { icon: Boxes, name: 'Agent SDK', status: 'planned', body: 'Embed safe, private spending into any app or agent in a few lines of code.' },
  { icon: Layers, name: 'Stellar MCP server', status: 'planned', body: 'Let any AI agent discover and pay for services under a policy, natively over MCP.' },
  { icon: Sparkles, name: 'On-chain registry', status: 'planned', body: 'Verifiable service discovery and reputation, stored on Soroban.' },
];
const STATUS: Record<OfferStatus, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
  dev: { label: 'In development', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/25' },
  planned: { label: 'Planned', cls: 'bg-white/5 text-slate-400 border-white/10' },
};

/** Interactive, mock demo of a private spending policy. No backend, illustrative only. */
function PrivacyDemo() {
  const [cap, setCap] = useState(true);
  const [allow, setAllow] = useState(true);
  const [weekly, setWeekly] = useState(true);
  const [paid, setPaid] = useState(false);

  const rules = [
    cap ? 'Max $100 per payment' : null,
    allow ? 'Only 5 approved providers' : null,
    weekly ? 'Max $500 per week' : null,
  ].filter(Boolean) as string[];

  // Deterministic pseudo-commitment from the active rules (for demonstration).
  const commitment = (() => {
    const s = rules.join('|') + '::salt';
    let h = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    const hex = h.toString(16).padStart(8, '0');
    return '0x' + (hex + hex + hex + hex + hex).slice(0, 40);
  })();

  const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <button
      onClick={() => { set(!on); setPaid(false); }}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${on ? 'border-violet-500/40 bg-violet-500/10 text-slate-100' : 'border-white/10 bg-white/[0.02] text-slate-500'}`}
    >
      <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-violet-500' : 'bg-white/10'}`}>
        {on && <CheckCircle2 size={12} className="text-white" />}
      </span>
      {label}
    </button>
  );

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-left">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Your private policy</p>
        <p className="mt-1 text-sm text-slate-400">Toggle the rules the vault should enforce.</p>
        <div className="mt-4 grid gap-2">
          <Toggle on={cap} set={setCap} label="Max $100 per payment" />
          <Toggle on={allow} set={setAllow} label="Only 5 approved providers" />
          <Toggle on={weekly} set={setWeekly} label="Max $500 per week" />
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Committed on-chain (a hash)</p>
          <p className="mt-1 font-mono text-xs text-violet-300 break-all">{rules.length ? commitment : 'set at least one rule'}</p>
        </div>
        <button
          onClick={() => setPaid(true)}
          disabled={!rules.length}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition-all"
        >
          <Zap size={14} /> Simulate a $60 payment
        </button>
      </div>

      <div className="grid gap-5">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5 text-left">
          <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium"><Eye size={15} /> What you see</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-300">
            {rules.length ? rules.map((r) => (
              <li key={r} className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-400" /> {r}</li>
            )) : <li className="text-slate-500">No rules set.</li>}
          </ul>
          {paid && <p className="mt-3 text-sm text-emerald-300">Paid $60 to Chainlens. Within policy.</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left">
          <div className="flex items-center gap-2 text-slate-400 text-sm font-medium"><EyeOff size={15} /> What the public ledger sees</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-500 font-mono">
            <li>budget: ••••••</li>
            <li>payees: ••••••</li>
            <li>limits: ••••••</li>
            <li className="text-slate-400 break-all">policy: {rules.length ? commitment.slice(0, 18) + '…' : '—'}</li>
          </ul>
          {paid && <p className="mt-3 text-sm text-slate-300 flex items-start gap-1.5"><Fingerprint size={14} className="text-violet-400 mt-0.5 shrink-0" /> Proof verified. Payment allowed. Your rules stayed hidden.</p>}
        </div>
      </div>
    </div>
  );
}

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const launch = (
    <button
      onClick={onLaunch}
      className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition-all"
    >
      Launch App
      <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0b0d13] text-slate-200 overflow-x-hidden">
      {/* Nav */}
      <header className={`fixed top-0 inset-x-0 z-40 transition-colors ${scrolled ? 'bg-[#0b0d13]/85 backdrop-blur border-b border-white/5' : ''}`}>
        <nav className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <div className="hidden md:flex items-center gap-7 text-sm text-slate-400">
            <a href="#platform" className="hover:text-white transition-colors">Product</a>
            <a href="#marketplace" className="hover:text-white transition-colors">Marketplace</a>
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
          </div>
          <div className="flex items-center gap-3">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors" aria-label="GitHub">
              <Github size={18} />
            </a>
            {launch}
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative pt-40 pb-28 px-5">
        {/* animated background */}
        <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="cc-grid absolute inset-0" />
          <div className="cc-orb absolute -top-24 left-1/4 w-[36rem] h-[36rem] rounded-full bg-violet-600/20 blur-[120px]" />
          <div className="cc-orb absolute top-10 right-1/4 w-[30rem] h-[30rem] rounded-full bg-cyan-500/15 blur-[120px]" style={{ animationDelay: '3s' }} />
        </div>

        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
              <Sparkles size={12} className="text-violet-400" />
              Payment infrastructure for AI agents on Stellar
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-6 text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.05] text-balance">
              Let AI agents spend money.
              <br />
              <span className="cc-gradient-text">Safely and privately.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
              CleverCon gives an AI agent a budget it cannot overspend, enforced on-chain and kept private.
              Fund a non-custodial vault, hire services from an open marketplace, and stay in control the whole time.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-9 flex items-center justify-center gap-3 flex-wrap">
              {launch}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors">
                <Github size={15} /> View on GitHub
              </a>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <div className="mt-10 flex items-center justify-center gap-x-6 gap-y-2 flex-wrap text-xs text-slate-500">
              {['Non-custodial', 'Stellar Testnet', 'USDC settlement', 'Private by design'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-500/80" /> {t}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pillars */}
      <section id="pillars" className="px-5 py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
              A private rail, a live marketplace, and infrastructure to build on
            </h2>
            <p className="mt-3 text-slate-400">Three layers, one coherent product.</p>
          </Reveal>
          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 90}>
                <div className={`relative h-full rounded-2xl border ${p.border} bg-white/[0.02] p-6 overflow-hidden`}>
                  <div className={`absolute inset-0 bg-gradient-to-b ${p.tint} pointer-events-none`} />
                  <div className="relative">
                    <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <p.icon size={19} className={p.ring} />
                    </div>
                    <p className="mt-4 text-xs uppercase tracking-wider text-slate-500 font-medium">{p.tag}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{p.title}</h3>
                    <p className="mt-2 text-sm text-slate-400 leading-relaxed">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Everything CleverCon offers */}
      <section id="platform" className="px-5 py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
              Everything CleverCon offers
            </h2>
            <p className="mt-3 text-slate-400">The vault and marketplace are live today. The rest is on the way, built in the open.</p>
          </Reveal>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {OFFERINGS.map((o, i) => {
              const st = STATUS[o.status];
              return (
                <Reveal key={o.name} delay={(i % 3) * 80}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                        <o.icon size={17} className="text-slate-300" />
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-white">{o.name}</h3>
                    <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{o.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Marketplace showcase */}
      <section id="marketplace" className="px-5 py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <p className="text-xs uppercase tracking-wider text-cyan-400 font-medium">The live application</p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
              An open marketplace of services, paid on Stellar
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Connect a wallet, fund a non-custodial vault, and hire from a marketplace that spans automated AI agents,
              human specialists, and business services. Search, filter by category, and sort by rating, price, or speed.
              The vault holds the funds and releases payment per step, so the platform never has custody.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-300">
              {['Three provider types: AI agents, human specialists, and businesses', 'Paid per call in USDC over x402 and MPP', 'Open registry: any service with a Stellar wallet can join'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 size={15} className="text-cyan-400 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-6">{launch}</div>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">Categories</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <span key={c} className="text-xs rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">{c}</span>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                {[['24', 'sample services'], ['7', 'categories'], ['3', 'provider types']].map(([n, l]) => (
                  <div key={l} className="rounded-xl border border-white/10 bg-white/[0.02] py-4">
                    <div className="text-2xl font-bold text-white">{n}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How you use it */}
      <section id="how" className="px-5 py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">How you use it</h2>
            <p className="mt-3 text-slate-400">
              The rail is always the same: bounded, private, per-step spending. How much coordination sits on top is up to the job.
            </p>
          </Reveal>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {USAGE_MODES.map((s, i) => (
              <Reveal key={s.title} delay={i * 80}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                      <s.icon size={17} className="text-violet-300" />
                    </div>
                    <span className="text-3xl font-bold text-white/10">{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120}>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex items-start gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Shield size={17} className="text-emerald-300" />
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                <span className="text-white font-medium">Whatever does the spending is just a delegate.</span> CleverCon's
                orchestrator, your own agent via the SDK, or an MCP client, it makes no difference. The rail is what makes
                delegation safe: even a compromised or careless delegate cannot spend outside the budget and private rules you set.
                That, not the planning, is the point.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Privacy */}
      <section id="privacy" className="px-5 py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <div className="inline-flex w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 items-center justify-center">
              <Eye size={22} className="text-violet-300" />
            </div>
            <h2 className="mt-5 text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
              Enforcement on-chain. Rules kept private.
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Most agent-payment tools put your budget, your approved payees, and every payment on a public ledger for anyone to read.
              CleverCon is built so the contract can enforce your spending policy and prove it was followed, without revealing the
              policy, the amounts, or the counterparties. That is what separates it from transparent, custodial, or SDK-only alternatives.
            </p>
            <p className="mt-4 text-sm text-slate-500">
              Built on the zero-knowledge engine already running on Stellar testnet as{' '}
              <a href={CIPHERMIT_URL} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1">
                CipherMit <ExternalLink size={11} />
              </a>. Bringing it into CleverVault is the core of the roadmap.
            </p>
          </Reveal>

          <Reveal delay={100}>
            <p className="mt-6 text-sm text-slate-400 leading-relaxed">
              Concretely: a trading firm funds an agent to buy research data and sets rules, only five approved providers,
              at most $100 a purchase, $500 a week. Without privacy, rivals read its budget, its providers (its edge), and
              when it ramps up before a trade. With CleverCon, the chain shows only that a payment was allowed. Try it:
            </p>
          </Reveal>
        </div>

        <div className="max-w-5xl mx-auto mt-8">
          <Reveal delay={140}><PrivacyDemo /></Reveal>
          <p className="mt-4 text-center text-xs text-slate-600">
            Interactive illustration. Values are mock; the commitment hash and proof are shown for demonstration only.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-20 border-t border-white/5">
        <Reveal className="max-w-4xl mx-auto">
          <div className="relative rounded-3xl border border-white/10 overflow-hidden p-10 sm:p-14 text-center">
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-600/20 via-transparent to-cyan-500/15" />
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
              Give your agent a wallet it can't misuse.
            </h2>
            <p className="mt-3 text-slate-300 max-w-xl mx-auto">
              Try it on Stellar testnet: connect a wallet, fund a vault, and explore the marketplace.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              {launch}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors">
                <Github size={15} /> GitHub
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="px-5 py-12 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-xs text-slate-600">Built on Stellar. Testnet.</span>
          </div>
          <div className="flex items-center gap-4">
            {SOCIALS.filter((s) => s.url && s.icon).map((s) => {
              const Icon = s.icon!;
              return (
                <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="text-slate-500 hover:text-white transition-colors" aria-label={s.label}>
                  <Icon size={17} />
                </a>
              );
            })}
            <a href={CIPHERMIT_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">CipherMit</a>
            <button onClick={onLaunch} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Launch App</button>
          </div>
        </div>
        <p className="max-w-6xl mx-auto mt-6 text-xs text-slate-700">
          On Stellar testnet, all assets are test assets with no real-world value.
        </p>
      </footer>
    </div>
  );
}
