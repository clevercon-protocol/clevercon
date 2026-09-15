import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

type Icon = ComponentType<{ size?: number; className?: string }>;

// ── Shared control styles ───────────────────────────────────────────────────
// One source of truth for buttons and form fields so every screen matches.
// In-app primary is a solid violet (calm); the brand gradient is reserved for
// the top-level Connect action so it stays a signature, not noise.

export const controls = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-950/40 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.02] px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors',
  chip: 'inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-white/[0.02] px-3 py-1.5 text-sm text-slate-300 hover:border-violet-500/40 hover:text-white transition-colors',
  field:
    'w-full rounded-lg border border-line-strong bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/15 transition-colors',
};

/** App button with variants. Falls through any native button props. */
export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return <button className={`${controls[variant]} ${className}`} {...rest} />;
}

// ── Page + section scaffolding ──────────────────────────────────────────────

/** Page title with optional eyebrow, description, and right-aligned action. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-300/80">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A small uppercase section label. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{children}</p>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** The standard surface panel. `interactive` adds a hover lift for clickable cards. */
export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface shadow-card ${
        interactive
          ? 'transition-colors hover:border-line-strong hover:bg-surface-2'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A card header row with an icon tile, title, optional hint, and action. */
export function CardHeader({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: Icon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/15">
          <Icon size={17} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  violet: 'text-violet-300 bg-violet-500/10 ring-violet-500/15',
  cyan: 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/15',
  emerald: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/15',
  amber: 'text-amber-300 bg-amber-500/10 ring-amber-500/15',
  sky: 'text-sky-300 bg-sky-500/10 ring-sky-500/15',
  slate: 'text-slate-300 bg-white/5 ring-white/10',
};

/** A compact KPI tile: icon, big value, small label. */
export function StatCard({
  icon: Icon,
  label,
  value,
  accent = 'violet',
  loading = false,
}: {
  icon: Icon;
  label: string;
  value: ReactNode;
  accent?: keyof typeof ACCENTS | string;
  loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ${ACCENTS[accent] ?? ACCENTS.violet}`}
      >
        <Icon size={17} />
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-white">{loading ? '…' : value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </Card>
  );
}

/** Muted placeholder for empty lists. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-white/[0.01] px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/** Skeleton placeholder while a list or panel loads. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-xl border border-line bg-white/[0.03]"
        />
      ))}
    </div>
  );
}

/** Recoverable error state for a failed fetch. */
export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-6 text-center text-sm text-red-300">
      {children}
    </div>
  );
}

/** Small pill badge. */
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}
