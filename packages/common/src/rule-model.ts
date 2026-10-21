/**
 * The unified, rail-agnostic spending-rule model shared by the API, SDK, and dapp.
 *
 * One authored rule is a named, versioned container of typed clauses. It is created
 * in one of two FORMS and keeps it: `private` (a hidden commitment enforced by a
 * per-payment ZK proof) or `public` (a cleartext session scope a key spends under,
 * checked directly). The clause vocabulary is the same for both; the form decides
 * privacy and how a spend is verified. See .local/PLAN-TO-BEST-VERSION.md.
 *
 * This module is intentionally dependency-light: it defines the shape, the honest
 * per-clause enforcement map, validation, a human summary, and a bridge to the
 * prover's bundle shape. It does NOT compute commitments or proofs (that is the
 * SDK/circuit path). Clauses map onto the circuit's R1-R8 vocabulary from
 * docs/private-policies-v2.md section 2; eligibility clauses are marketplace-level.
 */
import type { Tier } from './service-manifest.js';

/** How a rule is realized: hidden-and-proven, or public-and-key-checked. */
export type RuleForm = 'private' | 'public';

/** A rule is active (selectable/enforced) or archived (kept for audit, not used). */
export type RuleStatus = 'active' | 'archived';

/** Circuit-imposed bounds (fixed-size arrays in the compiled circuit). */
export const MAX_DENYLIST = 4; // R4 entries K
export const MAX_CALENDAR_WINDOWS = 2; // R6 windows W
export const MAX_CATEGORIES = 4; // R8 category ceilings C
export const MAX_ALLOWLIST = 65_536; // R3 Merkle depth 16

/** An approved payee: address plus an optional tighter per-payee cap (R5) and category (R8 leaf). */
export interface AllowlistEntry {
  address: string;
  perPayeeCapUsdc?: number;
  category?: number;
}

/** A calendar window (unix seconds) a release's validity must sit inside (R6). */
export interface CalendarWindow {
  startUnix: number;
  endUnix: number;
}

/**
 * A single rule clause. Spend clauses map to the circuit (R1-R8); eligibility
 * clauses constrain what/whom you may transact with and are enforced on-chain only
 * where the fact is anchored (category/tier/bond via the registry), otherwise at
 * the app layer. A rule holds at most one clause of each type.
 */
export type RuleClause =
  // ── Spend clauses (map to circuit R1-R8) ──────────────────────────────────
  | { type: 'perPaymentMax'; usdc: number } // R1 ceiling
  | { type: 'perPaymentMin'; usdc: number } // R1 floor (min; exact = min==max; range = [min,max])
  | { type: 'rollingCap'; usdc: number; windowSecs: number } // R2
  | { type: 'allowlist'; payees: AllowlistEntry[] } // R3 (+ R5 per-payee cap, R8 category per entry)
  | { type: 'denylist'; addresses: string[]; thresholdUsdc?: number } // R4
  | { type: 'calendar'; windows: CalendarWindow[] } // R6
  | { type: 'velocity'; maxCount: number; windowSecs: number } // R7
  | { type: 'categoryCeilings'; ceilingsUsdc: number[] } // R8
  // ── Eligibility clauses (marketplace: what/whom you may transact with) ─────
  | { type: 'tier'; allowed: Tier[] }
  | { type: 'bondStatus'; minBondUsdc: number }
  | { type: 'serviceAllow'; serviceIds: string[] }
  | { type: 'serviceDeny'; serviceIds: string[] }
  | { type: 'providerCriteria'; minReputation?: number; maxDisputeRate?: number; maxPriceUsdc?: number };

export type ClauseType = RuleClause['type'];

/** The clause of a given type, extracted from the union. */
export type ClauseOf<T extends ClauseType> = Extract<RuleClause, { type: T }>;

/** A named, versioned rule: a container of clauses, created in a fixed form. */
export interface Rule {
  /** Assigned by the store; absent before first persist. */
  id?: string;
  name: string;
  /** Fixed at creation; to reuse clauses in the other form, duplicate into a new rule. */
  form: RuleForm;
  status: RuleStatus;
  /** 1-based; an edit mints a new version that supersedes the prior. */
  version: number;
  /** The id of the rule this one supersedes (the edit lineage). */
  supersedes?: string;
  /** Flagged as the account's global for its lane (applies to every spend as an AND). */
  global?: boolean;
  clauses: RuleClause[];
}

// ── Honest enforcement map ────────────────────────────────────────────────────

/** Whether a clause is enforced on-chain now, committed but pending, or app-level. */
export type EnforcementStatus = 'enforced-now' | 'committed-pending' | 'app-enforced';

export interface ClauseEnforcement {
  status: EnforcementStatus;
  /** Which rule forms can enforce this clause. */
  modes: RuleForm[];
  /** Short human label for the builder. */
  label: string;
}

/**
 * The single source of truth for per-clause enforcement badges. The deployed
 * circuit enforces R1/R3/R5 (so perPaymentMax, allowlist, and the per-payee cap on
 * an allowlist entry are live); R2/R4/R6/R7/R8 and the R1 floor are committed into
 * the commitment but their enforcement is pending (circuit increments in Phase D).
 * Eligibility signals that are stable on-chain facts can be chain-enforced via the
 * registry/bonds; soft signals (reputation, price) are app-enforced and must never
 * be badged trustless. The `Record<ClauseType, ...>` type makes this exhaustive.
 */
export const CLAUSE_ENFORCEMENT: Record<ClauseType, ClauseEnforcement> = {
  perPaymentMax: { status: 'enforced-now', modes: ['private', 'public'], label: 'Max per payment' },
  perPaymentMin: { status: 'committed-pending', modes: ['private', 'public'], label: 'Min per payment' },
  rollingCap: { status: 'committed-pending', modes: ['private', 'public'], label: 'Rolling budget' },
  allowlist: { status: 'enforced-now', modes: ['private', 'public'], label: 'Approved payees' },
  denylist: { status: 'committed-pending', modes: ['private', 'public'], label: 'Blocked payees' },
  calendar: { status: 'committed-pending', modes: ['private', 'public'], label: 'Calendar window' },
  velocity: {
    status: 'committed-pending',
    modes: ['private', 'public'],
    label: 'Max payments per window',
  },
  categoryCeilings: {
    status: 'committed-pending',
    modes: ['private', 'public'],
    label: 'Per-category caps',
  },
  tier: { status: 'app-enforced', modes: ['private', 'public'], label: 'Allowed tiers' },
  bondStatus: { status: 'committed-pending', modes: ['private', 'public'], label: 'Min provider bond' },
  serviceAllow: { status: 'app-enforced', modes: ['private', 'public'], label: 'Allowed services' },
  serviceDeny: { status: 'app-enforced', modes: ['private', 'public'], label: 'Blocked services' },
  providerCriteria: { status: 'app-enforced', modes: ['private', 'public'], label: 'Provider criteria' },
};

/** True if a clause type can be enforced in the given form. */
export function clauseSupportsForm(type: ClauseType, form: RuleForm): boolean {
  return CLAUSE_ENFORCEMENT[type].modes.includes(form);
}

/** The weakest enforcement status across a rule's clauses (for a one-line badge). */
export function weakestEnforcement(rule: Rule): EnforcementStatus {
  const order: EnforcementStatus[] = ['enforced-now', 'committed-pending', 'app-enforced'];
  let worst = 0;
  for (const c of rule.clauses) worst = Math.max(worst, order.indexOf(CLAUSE_ENFORCEMENT[c.type].status));
  return order[worst] ?? 'enforced-now';
}

// ── Lookup + validation ─────────────────────────────────────────────────────

/** The (single) clause of a given type on a rule, if present. */
export function getClause<T extends ClauseType>(rule: Rule, type: T): ClauseOf<T> | undefined {
  return rule.clauses.find((c) => c.type === type) as ClauseOf<T> | undefined;
}

const isStellarAddr = (a: string): boolean => /^G[A-Z2-7]{55}$/.test(a.trim());

export interface RuleValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a rule's shape: a name, a form, at least one clause (no default-allow),
 * one clause per type, in-range amounts and counts, valid addresses, min <= max,
 * and the circuit's fixed-size bounds. Returns collected errors for the UI; it does
 * not check cross-rule satisfiability (that is a builder-time warning).
 */
export function validateRule(rule: Rule): RuleValidation {
  const errors: string[] = [];
  if (!rule.name || !rule.name.trim()) errors.push('A rule needs a name.');
  if (rule.form !== 'private' && rule.form !== 'public') {
    errors.push('Form must be private or public.');
  }
  const clauses = rule.clauses ?? [];
  if (clauses.length === 0) {
    errors.push('A rule must have at least one clause: there is no default-allow.');
  }

  const seen = new Set<ClauseType>();
  let min: number | undefined;
  let max: number | undefined;
  for (const c of clauses) {
    if (seen.has(c.type)) errors.push(`Only one ${c.type} clause is allowed.`);
    seen.add(c.type);
    switch (c.type) {
      case 'perPaymentMax':
        if (!(c.usdc > 0)) errors.push('Max per payment must be greater than 0.');
        else max = c.usdc;
        break;
      case 'perPaymentMin':
        if (!(c.usdc > 0)) errors.push('Min per payment must be greater than 0.');
        else min = c.usdc;
        break;
      case 'rollingCap':
        if (!(c.usdc > 0)) errors.push('Rolling cap must be greater than 0.');
        if (!(c.windowSecs > 0)) errors.push('Rolling cap needs a window greater than 0.');
        break;
      case 'velocity':
        if (!(c.maxCount > 0)) errors.push('Velocity count must be greater than 0.');
        if (!(c.windowSecs > 0)) errors.push('Velocity needs a window greater than 0.');
        break;
      case 'allowlist':
        if (!c.payees.length) errors.push('Allowlist is empty: add a payee or drop the clause.');
        if (c.payees.length > MAX_ALLOWLIST) errors.push(`Allowlist exceeds ${MAX_ALLOWLIST} payees.`);
        for (const p of c.payees) {
          if (!isStellarAddr(p.address)) errors.push(`Invalid payee address: ${p.address}.`);
          if (p.perPayeeCapUsdc != null && !(p.perPayeeCapUsdc > 0)) {
            errors.push('A per-payee cap must be greater than 0.');
          }
          if (p.category != null && (p.category < 0 || p.category >= MAX_CATEGORIES)) {
            errors.push(`Payee category must be 0..${MAX_CATEGORIES - 1}.`);
          }
        }
        break;
      case 'denylist':
        if (!c.addresses.length) errors.push('Denylist is empty: add an address or drop the clause.');
        if (c.addresses.length > MAX_DENYLIST) errors.push(`Denylist exceeds ${MAX_DENYLIST} addresses.`);
        for (const a of c.addresses) if (!isStellarAddr(a)) errors.push(`Invalid denylist address: ${a}.`);
        if (c.thresholdUsdc != null && !(c.thresholdUsdc >= 0)) {
          errors.push('Denylist threshold must be 0 or more.');
        }
        break;
      case 'calendar':
        if (!c.windows.length) errors.push('Calendar has no windows.');
        if (c.windows.length > MAX_CALENDAR_WINDOWS) {
          errors.push(`Calendar exceeds ${MAX_CALENDAR_WINDOWS} windows.`);
        }
        for (const w of c.windows) {
          if (!(w.endUnix > w.startUnix)) errors.push('A calendar window must end after it starts.');
        }
        break;
      case 'categoryCeilings':
        if (!c.ceilingsUsdc.length) errors.push('Category ceilings are empty.');
        if (c.ceilingsUsdc.length > MAX_CATEGORIES) {
          errors.push(`Category ceilings exceed ${MAX_CATEGORIES}.`);
        }
        for (const v of c.ceilingsUsdc) if (!(v > 0)) errors.push('Each category ceiling must be greater than 0.');
        break;
      case 'bondStatus':
        if (!(c.minBondUsdc > 0)) errors.push('Minimum bond must be greater than 0.');
        break;
      case 'tier':
        if (!c.allowed.length) errors.push('Tier clause lists no tiers.');
        break;
      case 'serviceAllow':
        if (!c.serviceIds.length) errors.push('Allowed-services clause lists no services.');
        break;
      case 'serviceDeny':
        if (!c.serviceIds.length) errors.push('Blocked-services clause lists no services.');
        break;
      case 'providerCriteria':
        if (c.maxDisputeRate != null && (c.maxDisputeRate < 0 || c.maxDisputeRate > 1)) {
          errors.push('Max dispute rate must be between 0 and 1.');
        }
        break;
    }
  }
  if (min != null && max != null && min > max) {
    errors.push('Min per payment cannot exceed max per payment.');
  }
  return { ok: errors.length === 0, errors };
}

// ── Human summary ────────────────────────────────────────────────────────────

const windowLabel = (secs: number): string => {
  if (secs === 86_400) return 'day';
  if (secs === 604_800) return 'week';
  if (secs === 2_592_000) return '30 days';
  if (secs % 86_400 === 0) return `${secs / 86_400}d`;
  if (secs % 3_600 === 0) return `${secs / 3_600}h`;
  return `${secs}s`;
};

/** A short, plain-language summary of a rule for lists, pickers, and the builder. */
export function describeRule(rule: Rule): string {
  const parts: string[] = [];
  const max = getClause(rule, 'perPaymentMax');
  const min = getClause(rule, 'perPaymentMin');
  if (max && min) parts.push(`$${min.usdc}-$${max.usdc}/payment`);
  else if (max) parts.push(`max $${max.usdc}/payment`);
  else if (min) parts.push(`min $${min.usdc}/payment`);

  const roll = getClause(rule, 'rollingCap');
  if (roll) parts.push(`up to $${roll.usdc}/${windowLabel(roll.windowSecs)}`);
  const vel = getClause(rule, 'velocity');
  if (vel) parts.push(`max ${vel.maxCount} payment(s)/${windowLabel(vel.windowSecs)}`);
  const allow = getClause(rule, 'allowlist');
  if (allow) parts.push(`${allow.payees.length} approved payee(s)`);
  const deny = getClause(rule, 'denylist');
  if (deny) parts.push(`${deny.addresses.length} blocked payee(s)`);
  const cal = getClause(rule, 'calendar');
  if (cal) parts.push(`${cal.windows.length} calendar window(s)`);
  const tier = getClause(rule, 'tier');
  if (tier) parts.push(`tiers ${tier.allowed.join('/')}`);
  const bond = getClause(rule, 'bondStatus');
  if (bond) parts.push(`bond >= $${bond.minBondUsdc}`);

  parts.push(rule.form);
  if (rule.global) parts.push('global');
  return parts.length ? parts.join(' · ') : 'no clauses';
}

// ── Bridge to the prover's bundle shape ──────────────────────────────────────

/**
 * Structurally compatible with the SDK's `PolicyBundleRules` (USDC/seconds terms),
 * so a {@link Rule} can be proven without `@clevercon/common` depending on the SDK.
 * Only the circuit-backed spend clauses map here; eligibility clauses are enforced
 * elsewhere and are intentionally dropped.
 */
export interface BundleRules {
  perPaymentCeilingUsdc: number;
  rollingCapUsdc?: number;
  rollingWindowSecs?: number;
  allowlist?: { payeeAddress: string; perPayeeCapUsdc?: number; category?: number }[];
  denylist?: string[];
  denylistThresholdUsdc?: number;
  calendarWindows?: { startUnix: number; endUnix: number }[];
  maxReleasesPerWindow?: number;
  velocityWindowSecs?: number;
  categoryCeilingsUsdc?: number[];
}

/**
 * Project a {@link Rule} onto {@link BundleRules} for the prover. Requires a
 * `perPaymentMax` clause (the circuit's R1 ceiling is mandatory today). Note the R1
 * floor (`perPaymentMin`) and the eligibility clauses are not yet circuit inputs, so
 * they are dropped here; the enforcement map marks them accordingly.
 */
export function ruleToBundleRules(rule: Rule): BundleRules {
  const max = getClause(rule, 'perPaymentMax');
  if (!max) throw new Error('ruleToBundleRules: a perPaymentMax clause is required (the R1 ceiling).');
  const roll = getClause(rule, 'rollingCap');
  const vel = getClause(rule, 'velocity');
  const allow = getClause(rule, 'allowlist');
  const deny = getClause(rule, 'denylist');
  const cal = getClause(rule, 'calendar');
  const cats = getClause(rule, 'categoryCeilings');
  return {
    perPaymentCeilingUsdc: max.usdc,
    rollingCapUsdc: roll?.usdc,
    rollingWindowSecs: roll?.windowSecs,
    allowlist: allow?.payees.map((p) => ({
      payeeAddress: p.address,
      perPayeeCapUsdc: p.perPayeeCapUsdc,
      category: p.category,
    })),
    denylist: deny?.addresses,
    denylistThresholdUsdc: deny?.thresholdUsdc,
    calendarWindows: cal?.windows,
    maxReleasesPerWindow: vel?.maxCount,
    velocityWindowSecs: vel?.windowSecs,
    categoryCeilingsUsdc: cats?.ceilingsUsdc,
  };
}

/** A fresh rule container in the given form (no clauses yet; add them in the builder). */
export function emptyRule(form: RuleForm = 'private', name = ''): Rule {
  return { name, form, status: 'active', version: 1, clauses: [] };
}
