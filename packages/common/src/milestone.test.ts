import { describe, it, expect } from 'vitest';
import {
  normalizeMilestones,
  singleMilestone,
  acceptedTotal,
  type Milestone,
} from './milestone.js';

const sum = (ms: Milestone[]) => ms.reduce((a, m) => a + m.amountUsdc, 0);

describe('normalizeMilestones', () => {
  it('an empty/invalid proposal becomes one milestone covering the whole price', () => {
    expect(normalizeMilestones(null, 0.02, 'Deliver')).toEqual([
      { id: 'm1', title: 'Deliver', criteria: '', amountUsdc: 0.02, status: 'pending' },
    ]);
  });

  it('a single proposed milestone takes the whole price', () => {
    const r = normalizeMilestones([{ title: 'A', criteria: 'x', amountUsdc: 5 }], 0.02, 'f');
    expect(r).toHaveLength(1);
    expect(r[0].amountUsdc).toBe(0.02);
    expect(r[0].title).toBe('A');
  });

  it('multiple milestones with amounts rescale to sum EXACTLY to the price', () => {
    const r = normalizeMilestones(
      [
        { title: 'A', amountUsdc: 1 },
        { title: 'B', amountUsdc: 1 },
        { title: 'C', amountUsdc: 1 },
      ],
      0.1,
      'f',
    );
    expect(r).toHaveLength(3);
    expect(sum(r)).toBeCloseTo(0.1, 7);
    expect(r.every((m) => m.status === 'pending')).toBe(true);
  });

  it('no amounts given -> even split summing to the price', () => {
    const r = normalizeMilestones([{ title: 'A' }, { title: 'B' }], 0.03, 'f');
    expect(r).toHaveLength(2);
    expect(sum(r)).toBeCloseTo(0.03, 7);
  });

  it('drops entries with no title', () => {
    const r = normalizeMilestones(
      [{ title: 'A', amountUsdc: 1 }, { criteria: 'no title' }],
      0.02,
      'f',
    );
    expect(r).toHaveLength(1);
  });
});

describe('singleMilestone / acceptedTotal', () => {
  it('singleMilestone is the whole step', () => {
    expect(singleMilestone('T', 'C', 0.05)).toMatchObject({ amountUsdc: 0.05, status: 'pending' });
  });
  it('acceptedTotal sums only accepted milestones', () => {
    const ms: Milestone[] = [
      { id: '1', title: 'a', criteria: '', amountUsdc: 0.01, status: 'accepted' },
      { id: '2', title: 'b', criteria: '', amountUsdc: 0.02, status: 'pending' },
      { id: '3', title: 'c', criteria: '', amountUsdc: 0.03, status: 'accepted' },
    ];
    expect(acceptedTotal(ms)).toBeCloseTo(0.04, 7);
  });
});
