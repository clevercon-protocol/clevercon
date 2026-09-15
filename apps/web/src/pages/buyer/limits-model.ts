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
