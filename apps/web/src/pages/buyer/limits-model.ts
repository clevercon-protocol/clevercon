import type { PolicyRules } from '../../lib/policies';
import type { PolicyBundleRules } from '@clevercon/agent-sdk/prover';
import { type Rule, type ClauseType, CLAUSE_ENFORCEMENT } from '@clevercon/common/rule-model';

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
  // R5 per-payee cap: an optional max-per-payment for a specific approved payee,
  // keyed by address (blank/absent = only the global ceiling applies to them).
  allowlistCaps: Record<string, string>;
  // R7 velocity: at most this many payments per velocity window. Kept on the
  // device only (like the rest of the private rule), proven alongside the caps.
  velocityCount: string;
  velocityWindow: keyof typeof WINDOWS;
};

export const emptyDraft = (): Draft => ({
  isPrivate: true,
  perPaymentCeiling: '',
  rollingCap: '',
  rollingWindow: 'week',
  allowlist: [],
  allowlistCaps: {},
  velocityCount: '',
  velocityWindow: 'week',
});

// Application presets: the real jobs people use CleverCon for. Each is a ready
// starting policy the owner adjusts (amounts are examples; add payees below).
export type PolicyTemplate = { key: string; label: string; description: string; make: () => Draft };

export const TEMPLATES: PolicyTemplate[] = [
  {
    key: 'bounty',
    label: 'Bounty / disbursement',
    description:
      'Pay approved recipients for bounties, grants, or paid work, capped per payout and per month. Add the recipient addresses below.',
    make: () => ({
      isPrivate: true,
      perPaymentCeiling: '500',
      rollingCap: '5000',
      rollingWindow: 'month',
      allowlist: [],
      allowlistCaps: {},
      velocityCount: '',
      velocityWindow: 'week',
    }),
  },
  {
    key: 'payroll',
    label: 'Payroll / vendors',
    description:
      'Recurring payments to an approved list of people or vendors, capped per payment and per month.',
    make: () => ({
      isPrivate: true,
      perPaymentCeiling: '2000',
      rollingCap: '20000',
      rollingWindow: 'month',
      allowlist: [],
      allowlistCaps: {},
      velocityCount: '',
      velocityWindow: 'week',
    }),
  },
  {
    key: 'grant',
    label: 'Grant / gift',
    description: 'One-off or batch gifts and grants to approved recipients, capped per payment.',
    make: () => ({
      isPrivate: true,
      perPaymentCeiling: '1000',
      rollingCap: '',
      rollingWindow: 'month',
      allowlist: [],
      allowlistCaps: {},
      velocityCount: '',
      velocityWindow: 'week',
    }),
  },
  {
    key: 'allowance',
    label: 'Agent allowance',
    description:
      'A bounded wallet for an agent: a small cap per payment and per week, to any payee within the caps.',
    make: () => ({
      isPrivate: true,
      perPaymentCeiling: '50',
      rollingCap: '200',
      rollingWindow: 'week',
      allowlist: [],
      allowlistCaps: {},
      velocityCount: '',
      velocityWindow: 'week',
    }),
  },
];

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

/**
 * Map the device-local {@link Draft} onto the shared, clause-based {@link Rule}
 * model from `@clevercon/common`. This is the canonical representation the API
 * and SDK also consume; here it drives the honest per-clause enforcement badges
 * so the builder never implies a pending rule is enforced on-chain today.
 */
export function draftToRule(d: Draft, name = ''): Rule {
  const clauses: Rule['clauses'] = [];
  if (d.perPaymentCeiling) {
    clauses.push({ type: 'perPaymentMax', usdc: Number(d.perPaymentCeiling) });
  }
  const rollSecs = WINDOWS[d.rollingWindow].secs;
  if (d.rollingCap && rollSecs) {
    clauses.push({ type: 'rollingCap', usdc: Number(d.rollingCap), windowSecs: rollSecs });
  }
  const velSecs = WINDOWS[d.velocityWindow].secs;
  if (d.velocityCount && velSecs) {
    clauses.push({ type: 'velocity', maxCount: Number(d.velocityCount), windowSecs: velSecs });
  }
  if (d.allowlist.length) {
    clauses.push({
      type: 'allowlist',
      payees: d.allowlist.map((a) => {
        const cap = d.allowlistCaps[a];
        return cap ? { address: a, perPayeeCapUsdc: Number(cap) } : { address: a };
      }),
    });
  }
  return { name, form: d.isPrivate ? 'private' : 'public', status: 'active', version: 1, clauses };
}

/** A short human label for a clause's enforcement status, for the builder badge. */
export function enforcementText(status: string): string {
  if (status === 'enforced-now') return 'on-chain now';
  if (status === 'committed-pending') return 'pending';
  return 'app-enforced';
}

/**
 * The per-active-clause enforcement badges for the builder, read from the shared
 * `CLAUSE_ENFORCEMENT` map so the dapp, API, and SDK agree on what is actually
 * enforced on-chain versus committed-but-pending versus app-enforced.
 */
export function draftClauseBadges(d: Draft): { label: string; status: string }[] {
  return draftToRule(d).clauses.map((c) => {
    const e = CLAUSE_ENFORCEMENT[c.type as ClauseType];
    return { label: e.label, status: e.status };
  });
}

export function describeDraft(d: Draft): string {
  const parts: string[] = [];
  if (d.perPaymentCeiling) parts.push(`max $${d.perPaymentCeiling}/payment`);
  if (d.rollingCap) parts.push(`max $${d.rollingCap} ${WINDOWS[d.rollingWindow].label}`);
  if (d.velocityCount)
    parts.push(`max ${d.velocityCount} payment(s) ${WINDOWS[d.velocityWindow].label}`);
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

/**
 * Map a device-local {@link Draft} onto the SDK prover's {@link PolicyBundleRules}.
 * This is the lossless bridge (it carries velocity and, in future, per-payee caps
 * and calendar windows that the server-side rule shape does not), so Disburse
 * proves exactly what the owner built.
 */
export function draftToBundleRules(d: Draft): PolicyBundleRules {
  const rollSecs = WINDOWS[d.rollingWindow].secs;
  const velSecs = WINDOWS[d.velocityWindow].secs;
  // R2 and R7 each need both their cap/count AND a real window, or neither.
  const rollOn = !!(d.rollingCap && rollSecs);
  const velOn = !!(d.velocityCount && velSecs);
  return {
    perPaymentCeilingUsdc: d.perPaymentCeiling ? Number(d.perPaymentCeiling) : 0,
    rollingCapUsdc: rollOn ? Number(d.rollingCap) : undefined,
    rollingWindowSecs: rollOn ? rollSecs : undefined,
    allowlist: d.allowlist.length
      ? d.allowlist.map((a) => {
          const cap = d.allowlistCaps[a];
          return cap ? { payeeAddress: a, perPayeeCapUsdc: Number(cap) } : { payeeAddress: a };
        })
      : undefined,
    maxReleasesPerWindow: velOn ? Number(d.velocityCount) : undefined,
    velocityWindowSecs: velOn ? velSecs : undefined,
  };
}

/**
 * Map the server-side saved-limit rule shape onto {@link PolicyBundleRules}. Used
 * for transparent limits (and private limits created on another device) where only
 * the server rule is available; it covers the ceiling, rolling cap, allowlist, and
 * deny-list. The ceiling may be 0 here; Disburse supplies its own editable ceiling.
 */
export function rulesToBundleRules(r: PolicyRules): PolicyBundleRules {
  return {
    perPaymentCeilingUsdc: r.perPaymentCeilingUsdc ?? 0,
    rollingCapUsdc: r.rollingCapUsdc,
    rollingWindowSecs: r.rollingWindowSecs,
    allowlist: r.allowlist?.length ? r.allowlist.map((a) => ({ payeeAddress: a })) : undefined,
    denylist: r.denylist?.length ? r.denylist : undefined,
    denylistThresholdUsdc: r.denylistThresholdUsdc,
  };
}

/**
 * The full prover rules behind a saved limit: this device's local {@link Draft}
 * when present (lossless), else the server rule. Returns null when neither exists
 * (a private limit created on another device). The caller supplies the ceiling.
 */
export function savedLimitBundleRules(p: {
  rules?: PolicyRules | null;
  commitment: string;
}): PolicyBundleRules | null {
  try {
    const cached = localStorage.getItem(LIMIT_CACHE_PREFIX + p.commitment);
    if (cached) return draftToBundleRules(JSON.parse(cached) as Draft);
  } catch {
    // ignore
  }
  if (p.rules) return rulesToBundleRules(p.rules);
  return null;
}
