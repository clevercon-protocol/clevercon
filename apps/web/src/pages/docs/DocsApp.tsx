import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { Layers, Menu, X, Github, ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import { DOCS, DOC_GROUPS, DOC_BY_SLUG } from './content';

const GITHUB_URL = 'https://github.com/clevercon-protocol/clevercon';

function Sidebar({ active, onNavigate }: { active: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-6">
      {DOC_GROUPS.map((group) => (
        <div key={group}>
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {group}
          </div>
          <ul className="space-y-0.5">
            {DOCS.filter((d) => d.group === group).map((d) => {
              const on = d.slug === active;
              return (
                <li key={d.slug}>
                  <Link
                    to={`/docs/${d.slug}`}
                    onClick={onNavigate}
                    className={`block rounded-lg px-3 py-1.5 text-[13.5px] transition-colors ${
                      on
                        ? 'bg-violet-500/[0.12] font-medium text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                    }`}
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsApp() {
  const { slug } = useParams();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = slug && DOC_BY_SLUG.has(slug) ? slug : 'introduction';
  const page = DOC_BY_SLUG.get(active)!;
  const idx = DOCS.findIndex((d) => d.slug === active);
  const prev = idx > 0 ? DOCS[idx - 1] : null;
  const next = idx < DOCS.length - 1 ? DOCS[idx + 1] : null;

  // Scroll to top (or to a #hash) on page change.
  useEffect(() => {
    setMobileOpen(false);
    if (loc.hash) {
      document.getElementById(loc.hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [loc.pathname, loc.hash]);

  return (
    <div className="min-h-screen bg-[#0a0b12] text-slate-200">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0a0b12]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/[0.06] lg:hidden"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-700">
                <Layers size={14} className="text-white" />
              </div>
              <span className="text-[14px] font-bold tracking-tight text-white">CleverCon</span>
              <span className="hidden text-[13px] text-slate-500 sm:inline">docs</span>
            </Link>
          </div>
          <div className="flex items-center gap-4 text-[13px]">
            <Link
              to="/"
              className="hidden text-slate-400 transition-colors hover:text-white sm:inline"
            >
              Home
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 transition-colors hover:text-white"
              aria-label="GitHub"
            >
              <Github size={17} />
            </a>
            <Link
              to="/connect"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-1.5 font-semibold text-white transition-all hover:from-violet-500 hover:to-indigo-500"
            >
              Launch app <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-white/5 px-4 py-8 lg:block">
          <Sidebar active={active} />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 top-14 w-72 overflow-y-auto border-r border-white/10 bg-[#0c0e16] px-4 py-6">
              <Sidebar active={active} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        {/* Content */}
        <main className="min-w-0 flex-1 px-5 py-10 sm:px-10">
          <article className="mx-auto max-w-3xl">
            <p className="text-[12px] font-medium uppercase tracking-wider text-violet-400">
              {page.group}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{page.title}</h1>
            <p className="mt-2 text-[15px] text-slate-500">{page.description}</p>
            <div className="mt-6">
              <page.Body />
            </div>

            {/* Prev / next */}
            <div className="mt-14 grid gap-3 border-t border-white/5 pt-6 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={`/docs/${prev.slug}`}
                  className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-violet-500/40 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <ArrowLeft size={13} /> Previous
                  </div>
                  <div className="mt-1 font-medium text-white">{prev.title}</div>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to={`/docs/${next.slug}`}
                  className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 text-right transition hover:border-violet-500/40 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-end gap-1.5 text-[12px] text-slate-500">
                    Next <ArrowRight size={13} />
                  </div>
                  <div className="mt-1 font-medium text-white">{next.title}</div>
                </Link>
              )}
            </div>

            <footer className="mt-12 flex items-center justify-between border-t border-white/5 pt-6 text-[12px] text-slate-600">
              <span>Built on Stellar. Testnet.</span>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-slate-400"
              >
                Edit on GitHub <ExternalLink size={11} />
              </a>
            </footer>
          </article>
        </main>
      </div>
    </div>
  );
}
