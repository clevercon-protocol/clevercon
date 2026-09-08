import type { ComponentType, ReactNode } from 'react';

type Icon = ComponentType<{ size?: number; className?: string }>;

/** Page title, description, and an optional right-aligned action. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** The standard surface panel used across the app. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.02] shadow-xl shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

/** A card header row with an icon, title, and optional action. */
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
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
          <Icon size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  violet: 'text-violet-300 bg-violet-500/10',
  cyan: 'text-cyan-300 bg-cyan-500/10',
  emerald: 'text-emerald-300 bg-emerald-500/10',
  amber: 'text-amber-300 bg-amber-500/10',
  sky: 'text-sky-300 bg-sky-500/10',
  slate: 'text-slate-300 bg-white/5',
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
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${ACCENTS[accent] ?? ACCENTS.violet}`}
      >
        <Icon size={16} />
      </div>
      <div className="mt-3 text-xl font-bold text-white">{loading ? '…' : value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </Card>
  );
}

/** Muted placeholder for empty lists. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-sm text-slate-500">
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
