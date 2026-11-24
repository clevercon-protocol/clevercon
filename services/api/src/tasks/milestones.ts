/**
 * API-local copy of the milestone normalizer. The compiled API cannot import a VALUE
 * from @clevercon/common at runtime (it is raw TS), only types, so the pure function is
 * duplicated here. KEEP IN SYNC with packages/common/src/milestone.ts.
 */
import type { Milestone, MilestoneInput } from '@clevercon/common';

const ROUND = 1e7; // USDC has 7 on-chain decimals
const round7 = (n: number): number => Math.round(n * ROUND) / ROUND;

function singleMilestone(title: string, criteria: string, amountUsdc: number): Milestone {
  return { id: 'm1', title, criteria, amountUsdc: round7(amountUsdc), status: 'pending' };
}

/**
 * Validate + normalize a proposed milestone list against a step price: keep titled
 * entries, clamp negatives, and rescale amounts to sum EXACTLY to the price (the last
 * absorbs any rounding remainder). Empty/invalid -> one milestone for the whole price.
 */
export function normalizeMilestones(
  raw: unknown,
  priceUsdc: number,
  fallbackTitle: string,
): Milestone[] {
  const price = round7(Math.max(0, Number(priceUsdc) || 0));
  const arr = Array.isArray(raw) ? (raw as MilestoneInput[]) : [];
  const cleaned = arr
    .map((m) => ({
      title: typeof m?.title === 'string' ? m.title.trim() : '',
      criteria: typeof m?.criteria === 'string' ? m.criteria.trim() : '',
      amount: Math.max(0, Number(m?.amountUsdc) || 0),
    }))
    .filter((m) => m.title.length > 0);

  if (cleaned.length === 0) return [singleMilestone(fallbackTitle, '', price)];
  if (cleaned.length === 1) {
    return [
      {
        id: 'm1',
        title: cleaned[0].title,
        criteria: cleaned[0].criteria,
        amountUsdc: price,
        status: 'pending',
      },
    ];
  }

  const proposedSum = cleaned.reduce((a, m) => a + m.amount, 0);
  const weights = proposedSum > 0 ? cleaned.map((m) => m.amount) : cleaned.map(() => 1);
  const weightSum = weights.reduce((a, w) => a + w, 0);

  let allocated = 0;
  return cleaned.map((m, i) => {
    const isLast = i === cleaned.length - 1;
    const amt = isLast ? round7(price - allocated) : round7((price * weights[i]) / weightSum);
    allocated = round7(allocated + amt);
    return {
      id: `m${i + 1}`,
      title: m.title,
      criteria: m.criteria,
      amountUsdc: amt,
      status: 'pending',
    };
  });
}

/** Whether a service tier gets milestones (judged tiers only; T1 auto-verifies). */
export function tierUsesMilestones(tier: string | null | undefined): boolean {
  return tier === 'T2' || tier === 'T3';
}
