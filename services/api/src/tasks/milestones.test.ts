import { describe, it, expect } from 'vitest';
import { settlementAmount, tierUsesMilestones, normalizeMilestones } from './milestones.js';

describe('settlementAmount (escrow-feel release)', () => {
  it('owes the full price when there are no milestones', () => {
    expect(settlementAmount(null, 0.05)).toBe(0.05);
    expect(settlementAmount([], 0.05)).toBe(0.05);
  });

  it('owes the full price while milestones are still pending (judge not run)', () => {
    const ms = [
      { id: 'm1', amountUsdc: 0.03, status: 'pending' },
      { id: 'm2', amountUsdc: 0.02, status: 'pending' },
    ];
    expect(settlementAmount(ms, 0.05)).toBe(0.05);
  });

  it('owes only the accepted milestones once decided', () => {
    const ms = [
      { id: 'm1', amountUsdc: 0.03, status: 'accepted' },
      { id: 'm2', amountUsdc: 0.02, status: 'rejected' },
    ];
    expect(settlementAmount(ms, 0.05)).toBe(0.03);
  });

  it('owes nothing when every milestone is rejected', () => {
    const ms = [
      { id: 'm1', amountUsdc: 0.03, status: 'rejected' },
      { id: 'm2', amountUsdc: 0.02, status: 'rejected' },
    ];
    expect(settlementAmount(ms, 0.05)).toBe(0);
  });

  it('owes the accepted sum when the list is partially judged', () => {
    const ms = [
      { id: 'm1', amountUsdc: 0.02, status: 'accepted' },
      { id: 'm2', amountUsdc: 0.02, status: 'pending' },
      { id: 'm3', amountUsdc: 0.01, status: 'rejected' },
    ];
    // Decided (one accepted, one rejected): owe only the accepted amount, not the
    // still-pending one. The full price is only owed while NOTHING is decided.
    expect(settlementAmount(ms, 0.05)).toBe(0.02);
  });

  it('rounds the accepted sum to 7 decimals', () => {
    const ms = [
      { id: 'm1', amountUsdc: 0.0333333, status: 'accepted' },
      { id: 'm2', amountUsdc: 0.0333334, status: 'accepted' },
    ];
    expect(settlementAmount(ms, 0.1)).toBe(0.0666667);
  });
});

describe('tierUsesMilestones', () => {
  it('is true only for the judged tiers', () => {
    expect(tierUsesMilestones('T1')).toBe(false);
    expect(tierUsesMilestones('T2')).toBe(true);
    expect(tierUsesMilestones('T3')).toBe(true);
    expect(tierUsesMilestones(null)).toBe(false);
  });
});

describe('normalizeMilestones (sanity: amounts sum to the price)', () => {
  it('rescales a multi-milestone proposal to sum exactly to the price', () => {
    const out = normalizeMilestones(
      [
        { title: 'A', amountUsdc: 1 },
        { title: 'B', amountUsdc: 1 },
        { title: 'C', amountUsdc: 1 },
      ],
      0.1,
      'Deliver',
    );
    expect(out).toHaveLength(3);
    const sum = out.reduce((a, m) => a + m.amountUsdc, 0);
    expect(Math.round(sum * 1e7) / 1e7).toBe(0.1);
    expect(out.every((m) => m.status === 'pending')).toBe(true);
  });
});
