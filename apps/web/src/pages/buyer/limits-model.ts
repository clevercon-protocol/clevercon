import type { PolicyRules } from '../../lib/policies';

// Non-component helpers for the limits UI, kept out of the component module so
// React Fast Refresh can hot-update the components cleanly.

export const WINDOWS: Record<string, { label: string; secs?: number }> = {
  none: { label: 'no time window' },
  day: { label: 'per day', secs: 86_400 },
  week: { label: 'per week', secs: 604_800 },
  month: { label: 'per 30 days', secs: 2_592_000 },
};

export type Draft = {
  isPrivate: boolean;
  perPaymentCeiling: string;
  rollingCap: string;
  rollingWindow: keyof typeof WINDOWS;
  allowlist: string[];
};

export const emptyDraft = (): Draft => ({
  isPrivate: true,
  perPaymentCeiling: '',
  rollingCap: '',
  rollingWindow: 'week',
  allowlist: [],
});

export const isStellarAddr = (a: string) => /^G[A-Z2-7]{55}$/.test(a.trim());

export function draftToRules(d: Draft): { rules: PolicyRules; isPrivate: boolean } {
  const secs = WINDOWS[d.rollingWindow].secs;
  return {
    isPrivate: d.isPrivate,
    rules: {
      perPaymentCeilingUsdc: d.perPaymentCeiling ? Number(d.perPaymentCeiling) : undefined,
      rollingCapUsdc: d.rollingCap ? Number(d.rollingCap) : undefined,
      rollingWindowSecs: d.rollingCap && secs ? secs : undefined,
      allowlist: d.allowlist.length ? d.allowlist : undefined,
    },
  };
}

export function describeDraft(d: Draft): string {
  const parts: string[] = [];
  if (d.perPaymentCeiling) parts.push(`max $${d.perPaymentCeiling}/payment`);
  if (d.rollingCap) parts.push(`max $${d.rollingCap} ${WINDOWS[d.rollingWindow].label}`);
  parts.push(
    d.allowlist.length ? `only ${d.allowlist.length} allowed payee(s)` : 'any payee within caps',
  );
  parts.push(d.isPrivate ? 'rule private' : 'transparent');
  return parts.join(' · ');
}

/** A short, human summary of a saved rule (used on Home and in the limits list). */
export function describeRules(r: PolicyRules): string {
  const parts: string[] = [];
  if (r.perPaymentCeilingUsdc != null) parts.push(`max $${r.perPaymentCeilingUsdc}/payment`);
  if (r.rollingCapUsdc != null) parts.push(`max $${r.rollingCapUsdc}/window`);
  if (r.allowlist?.length) parts.push(`only ${r.allowlist.length} allowed payee(s)`);
  return parts.length ? parts.join(' · ') : 'no caps';
}

// The owner's private rules are never kept by the server (only a commitment is),
// so we cache the plaintext locally on the device that created the limit. This is
// the key both the builder and the picker read/write.
export const LIMIT_CACHE_PREFIX = 'cc:limit:';

/**
 * A readable summary of a saved limit for lists and pickers. Transparent limits
 * describe their server-held rule; private limits fall back to this device's
 * local copy, and only to "rule kept private" if there is none. Never a raw hash.
 */
export function describeSavedLimit(p: { rules?: PolicyRules | null; commitment: string }): string {
  if (p.rules) return describeRules(p.rules);
  try {
    const cached = localStorage.getItem(LIMIT_CACHE_PREFIX + p.commitment);
    if (cached) return describeRules(draftToRules(JSON.parse(cached) as Draft).rules);
  } catch {
    // ignore
  }
  return 'rule kept private';
}

// The owner's default limit is a local preference: the id of one saved limit that
// pre-fills each new instruction. It is never a lock (every instruction can override
// it), which matches the on-chain model where policy is bound per task.
const DEFAULT_KEY = 'cc:defaultLimit';

export function getDefaultLimitId(): string {
  try {
    return localStorage.getItem(DEFAULT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setDefaultLimitId(id: string): void {
  try {
    if (id) localStorage.setItem(DEFAULT_KEY, id);
    else localStorage.removeItem(DEFAULT_KEY);
  } catch {
    // ignore
  }
}
