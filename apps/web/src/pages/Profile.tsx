import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Building2, User as UserIcon, Boxes } from 'lucide-react';
import { getPublicProfile, type ProfileLinks } from '../lib/org';
import { tierLabel } from '../lib/services';

const LINK_LABELS: { k: keyof ProfileLinks; label: string }[] = [
  { k: 'website', label: 'Website' },
  { k: 'docs', label: 'Docs' },
  { k: 'support', label: 'Support' },
  { k: 'github', label: 'GitHub' },
  { k: 'x', label: 'X' },
  { k: 'discord', label: 'Discord' },
];

function hrefOf(v: string): string {
  if (v.startsWith('http')) return v;
  if (v.includes('@') && !v.includes('/')) return `mailto:${v}`;
  return `https://${v}`;
}

/** A public owner profile: an organization or an individual provider, with their services. */
export function Profile() {
  const { handle = '' } = useParams();
  const { data: p, isLoading, error } = useQuery({
    queryKey: ['profile', handle],
    queryFn: () => getPublicProfile(handle),
  });

  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link
        to="/app/services"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} /> Back to marketplace
      </Link>

      {isLoading && <p className="text-sm text-slate-500">Loading profile…</p>}
      {error && <p className="text-sm text-red-400">No profile with that handle.</p>}

      {p && (
        <>
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.06]">
              {p.type === 'org' ? (
                <Building2 size={24} className="text-violet-300" />
              ) : (
                <UserIcon size={24} className="text-violet-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{p.name}</h1>
                {p.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300">
                    <BadgeCheck size={14} /> Verified
                  </span>
                )}
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">
                  {p.type === 'org' ? 'Organization' : 'Provider'}
                </span>
              </div>
              <p className="text-sm text-slate-500">@{p.handle}</p>
              {p.bio && <p className="mt-2 text-sm leading-relaxed text-slate-300">{p.bio}</p>}
              {p.links && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {LINK_LABELS.filter(({ k }) => (p.links?.[k] ?? '').trim()).map(({ k, label }) => (
                    <a
                      key={k}
                      href={hrefOf(p.links![k] as string)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.06] px-3 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Boxes size={16} className="text-violet-300" />
              <h2 className="font-semibold text-white">Services</h2>
              <span className="text-xs text-slate-500">{p.services.length}</span>
            </div>
            {p.services.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No active services listed.</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {p.services.map((s) => (
                  <Link
                    key={s.id}
                    to={`/app/marketplace/${s.id}`}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 transition-colors hover:border-white/10 hover:bg-white/[0.06]"
                  >
                    <div className="font-medium">{s.name}</div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>{s.category ?? 'Uncategorised'}</span>
                      <span>{tierLabel(s.tier as 'T1' | 'T2' | 'T3')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
