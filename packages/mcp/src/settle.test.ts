import { describe, it, expect } from 'vitest';
import { unpaidReleased, type HireTaskDetail } from './settle.js';

function task(steps: Partial<HireTaskDetail['steps'][number]>[]): HireTaskDetail {
  return {
    id: 't1',
    status: 'COMPLETED',
    steps: steps.map((s, i) => ({
      id: s.id ?? `s${i}`,
      status: s.status ?? 'RELEASED',
      paid: s.paid,
      payee: 'payee' in s ? (s.payee as string | null) : 'GPROVIDER',
      estimatedCost: 'estimatedCost' in s ? (s.estimatedCost as number) : 0.02,
    })),
  };
}

describe('unpaidReleased', () => {
  it('selects a delivered, unpaid step with a payee and a positive cost', () => {
    const out = unpaidReleased(task([{ status: 'RELEASED', paid: false }]));
    expect(out).toHaveLength(1);
  });

  it('skips a step that is already paid', () => {
    expect(unpaidReleased(task([{ status: 'RELEASED', paid: true }]))).toHaveLength(0);
  });

  it('skips a step that is not yet RELEASED (not delivered/accepted)', () => {
    for (const status of ['PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'INPUT_REQUIRED', 'FAILED']) {
      expect(unpaidReleased(task([{ status, paid: false }]))).toHaveLength(0);
    }
  });

  it('skips a released step with no payee or zero cost (nothing to pay)', () => {
    expect(unpaidReleased(task([{ status: 'RELEASED', paid: false, payee: null }]))).toHaveLength(
      0,
    );
    expect(
      unpaidReleased(task([{ status: 'RELEASED', paid: false, estimatedCost: 0 }])),
    ).toHaveLength(0);
  });

  it('selects only the unpaid released steps from a mix', () => {
    const out = unpaidReleased(
      task([
        { id: 'a', status: 'RELEASED', paid: false },
        { id: 'b', status: 'RELEASED', paid: true },
        { id: 'c', status: 'RUNNING', paid: false },
        { id: 'd', status: 'RELEASED', paid: false },
      ]),
    );
    expect(out.map((s) => s.id)).toEqual(['a', 'd']);
  });
});
