import { describe, it, expect } from 'vitest';
import {
  type Rule,
  CLAUSE_ENFORCEMENT,
  validateRule,
  describeRule,
  ruleToBundleRules,
  clauseSupportsForm,
  weakestEnforcement,
  getClause,
  emptyRule,
} from './rule-model.js';

const G1 = 'GCSA2DXVIWAVUMIPWW23BU2DVYQBDTS2YRQTPQ5NQ2N3YRM546T7FNSJ';
const G2 = 'GCTUUNAVAAT3SVV66YYH5XBYBQZDQ57D7VP46C7F6RGMFNGVAKS7CKHJ';

function rule(partial: Partial<Rule>): Rule {
  return { name: 'r', form: 'private', status: 'active', version: 1, clauses: [], ...partial };
}

describe('validateRule', () => {
  it('accepts a well-formed private rule', () => {
    const r = rule({
      clauses: [
        { type: 'perPaymentMax', usdc: 100 },
        { type: 'allowlist', payees: [{ address: G1 }, { address: G2, perPayeeCapUsdc: 50 }] },
      ],
    });
    expect(validateRule(r)).toEqual({ ok: true, errors: [] });
  });

  it('rejects an empty rule (no default-allow)', () => {
    const r = validateRule(rule({ clauses: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('at least one clause'))).toBe(true);
  });

  it('rejects a nameless rule', () => {
    const r = validateRule(rule({ name: '  ', clauses: [{ type: 'perPaymentMax', usdc: 1 }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects min greater than max', () => {
    const r = validateRule(
      rule({ clauses: [{ type: 'perPaymentMax', usdc: 10 }, { type: 'perPaymentMin', usdc: 20 }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('min per payment cannot exceed'))).toBe(true);
  });

  it('accepts exact-amount (min == max)', () => {
    const r = validateRule(
      rule({ clauses: [{ type: 'perPaymentMax', usdc: 10 }, { type: 'perPaymentMin', usdc: 10 }] }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a duplicate clause type', () => {
    const r = validateRule(
      rule({ clauses: [{ type: 'perPaymentMax', usdc: 10 }, { type: 'perPaymentMax', usdc: 20 }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Only one perPaymentMax'))).toBe(true);
  });

  it('rejects an invalid payee address', () => {
    const r = validateRule(
      rule({ clauses: [{ type: 'perPaymentMax', usdc: 10 }, { type: 'allowlist', payees: [{ address: 'nope' }] }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Invalid payee address'))).toBe(true);
  });

  it('enforces the denylist and calendar circuit bounds', () => {
    const deny = validateRule(
      rule({ clauses: [{ type: 'denylist', addresses: Array(5).fill(G1) }] }),
    );
    expect(deny.errors.some((e) => e.includes('Denylist exceeds'))).toBe(true);
    const cal = validateRule(
      rule({
        clauses: [
          { type: 'calendar', windows: [1, 2, 3].map((i) => ({ startUnix: i, endUnix: i + 10 })) },
        ],
      }),
    );
    expect(cal.errors.some((e) => e.includes('Calendar exceeds'))).toBe(true);
  });

  it('rejects a calendar window that does not end after it starts', () => {
    const r = validateRule(rule({ clauses: [{ type: 'calendar', windows: [{ startUnix: 100, endUnix: 100 }] }] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('end after it starts'))).toBe(true);
  });
});

describe('describeRule', () => {
  it('summarizes amounts, payees, and form', () => {
    const s = describeRule(
      rule({
        clauses: [
          { type: 'perPaymentMax', usdc: 100 },
          { type: 'rollingCap', usdc: 500, windowSecs: 604_800 },
          { type: 'allowlist', payees: [{ address: G1 }, { address: G2 }] },
        ],
      }),
    );
    expect(s).toContain('max $100/payment');
    expect(s).toContain('up to $500/week');
    expect(s).toContain('2 approved payee(s)');
    expect(s).toContain('private');
  });

  it('shows a range when min and max are both set, and marks global', () => {
    const s = describeRule(
      rule({
        global: true,
        clauses: [{ type: 'perPaymentMax', usdc: 100 }, { type: 'perPaymentMin', usdc: 10 }],
      }),
    );
    expect(s).toContain('$10-$100/payment');
    expect(s).toContain('global');
  });
});

describe('ruleToBundleRules', () => {
  it('maps spend clauses and drops the floor + eligibility clauses', () => {
    const r = rule({
      clauses: [
        { type: 'perPaymentMax', usdc: 100 },
        { type: 'perPaymentMin', usdc: 10 }, // dropped: not a circuit input yet
        { type: 'rollingCap', usdc: 500, windowSecs: 604_800 },
        { type: 'velocity', maxCount: 5, windowSecs: 604_800 },
        { type: 'allowlist', payees: [{ address: G1, perPayeeCapUsdc: 40, category: 1 }] },
        { type: 'denylist', addresses: [G2], thresholdUsdc: 0 },
        { type: 'tier', allowed: ['T1'] }, // dropped: eligibility, not a witness
      ],
    });
    const b = ruleToBundleRules(r);
    expect(b.perPaymentCeilingUsdc).toBe(100);
    expect(b.rollingCapUsdc).toBe(500);
    expect(b.rollingWindowSecs).toBe(604_800);
    expect(b.maxReleasesPerWindow).toBe(5);
    expect(b.allowlist).toEqual([{ payeeAddress: G1, perPayeeCapUsdc: 40, category: 1 }]);
    expect(b.denylist).toEqual([G2]);
    expect(b.denylistThresholdUsdc).toBe(0);
    // No field carries the floor or the tier.
    expect(Object.keys(b)).not.toContain('perPaymentMinUsdc');
  });

  it('requires a perPaymentMax clause (R1 ceiling)', () => {
    expect(() => ruleToBundleRules(rule({ clauses: [{ type: 'velocity', maxCount: 1, windowSecs: 60 }] }))).toThrow(
      /perPaymentMax/,
    );
  });
});

describe('enforcement map', () => {
  it('marks the circuit-proven clauses enforced-now and app facts app-enforced', () => {
    // The pp/2 circuit proves R1-R8 for the PRIVATE lane (buildPolicyWitness wires
    // every clause), so these are all enforced on-chain, not pending.
    expect(CLAUSE_ENFORCEMENT.perPaymentMax.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.allowlist.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.rollingCap.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.velocity.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.denylist.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.calendar.status).toBe('enforced-now');
    expect(CLAUSE_ENFORCEMENT.categoryCeilings.status).toBe('enforced-now');
    // Registry-anchored facts are enforced at the app layer, not in the circuit.
    expect(CLAUSE_ENFORCEMENT.providerCriteria.status).toBe('app-enforced');
  });

  it('weakestEnforcement returns the softest clause status', () => {
    const r = rule({
      clauses: [{ type: 'perPaymentMax', usdc: 10 }, { type: 'providerCriteria', minReputation: 4 }],
    });
    expect(weakestEnforcement(r)).toBe('app-enforced');
  });

  it('clauseSupportsForm reflects the modes', () => {
    expect(clauseSupportsForm('perPaymentMax', 'public')).toBe(true);
    expect(clauseSupportsForm('allowlist', 'private')).toBe(true);
  });
});

describe('helpers', () => {
  it('emptyRule is a valid-shaped active private container with no clauses', () => {
    const r = emptyRule();
    expect(r.form).toBe('private');
    expect(r.status).toBe('active');
    expect(r.version).toBe(1);
    expect(r.clauses).toEqual([]);
  });

  it('getClause returns the typed clause', () => {
    const r = rule({ clauses: [{ type: 'rollingCap', usdc: 5, windowSecs: 60 }] });
    const c = getClause(r, 'rollingCap');
    expect(c?.usdc).toBe(5);
    expect(getClause(r, 'allowlist')).toBeUndefined();
  });
});
