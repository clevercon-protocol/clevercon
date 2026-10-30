import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ArrowRight, Info, Lightbulb, AlertTriangle } from 'lucide-react';

// Self-contained documentation primitives, styled to match the landing page so the
// docs read as one professional, cohesive surface (dark theme, violet accents). No
// markdown pipeline and no app design-system dependency, so /docs stays a lazy,
// standalone public bundle.

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[17px] leading-relaxed text-slate-300">{children}</p>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-4 text-[15px] leading-relaxed text-slate-400">{children}</p>;
}

/** A section heading with an anchor id, so links can deep-link into a page. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="group mt-12 scroll-mt-24 border-t border-white/5 pt-8 text-xl font-semibold tracking-tight text-white"
    >
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="ml-2 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 text-[15px] font-semibold text-white">{children}</h3>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="my-4 space-y-2 text-[15px] leading-relaxed text-slate-400">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-400/70" />
      <span>{children}</span>
    </li>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[13px] text-violet-200">
      {children}
    </code>
  );
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-slate-200">{children}</strong>;
}

/** A link to another doc page (internal) or an external resource. */
export function A({ to, href, children }: { to?: string; href?: string; children: ReactNode }) {
  const cls = 'text-violet-300 underline-offset-2 hover:text-violet-200 hover:underline';
  if (to)
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  );
}

export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          {title ?? lang ?? 'code'}
        </span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-[13px] leading-relaxed text-slate-200">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

const CALLOUT: Record<string, { icon: typeof Info; cls: string; ring: string }> = {
  note: {
    icon: Info,
    cls: 'border-sky-500/25 bg-sky-500/[0.06] text-sky-100',
    ring: 'text-sky-300',
  },
  tip: {
    icon: Lightbulb,
    cls: 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100',
    ring: 'text-emerald-300',
  },
  warn: {
    icon: AlertTriangle,
    cls: 'border-amber-500/30 bg-amber-500/[0.07] text-amber-100',
    ring: 'text-amber-300',
  },
};

export function Callout({
  kind = 'note',
  title,
  children,
}: {
  kind?: 'note' | 'tip' | 'warn';
  title?: string;
  children: ReactNode;
}) {
  const c = CALLOUT[kind];
  return (
    <div className={`my-5 flex gap-3 rounded-xl border p-4 ${c.cls}`}>
      <c.icon size={17} className={`mt-0.5 shrink-0 ${c.ring}`} />
      <div className="text-[14px] leading-relaxed">
        {title && <div className="mb-1 font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold text-slate-200">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.05] last:border-0">
              {r.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 align-top text-slate-400">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-5 space-y-4">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[12px] font-semibold text-violet-200">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium text-slate-200">{title}</div>
        {children && (
          <div className="mt-1 text-[14px] leading-relaxed text-slate-400">{children}</div>
        )}
      </div>
    </li>
  );
}

/** A grid of link cards for "next steps" / related pages. */
export function Cards({
  items,
}: {
  items: { to?: string; href?: string; title: string; desc: string }[];
}) {
  return (
    <div className="my-6 grid gap-3 sm:grid-cols-2">
      {items.map((it) => {
        const inner = (
          <>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">{it.title}</span>
              <ArrowRight
                size={15}
                className="text-slate-500 transition-transform group-hover:translate-x-0.5"
              />
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-400">{it.desc}</p>
          </>
        );
        const cls =
          'group block rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-violet-500/40 hover:bg-white/[0.04]';
        return it.to ? (
          <Link key={it.title} to={it.to} className={cls}>
            {inner}
          </Link>
        ) : (
          <a
            key={it.title}
            href={it.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cls}
          >
            {inner}
          </a>
        );
      })}
    </div>
  );
}
