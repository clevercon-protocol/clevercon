/**
 * Acceptance milestones for a judged (T2/T3) hire. A hire's price is split into one or
 * more milestones, each with its own acceptance criteria; the judge scores each on
 * delivery and (P2) funds release per accepted milestone. The amounts always sum to the
 * step price, so the release math is exact and a buyer never over- or under-pays.
 *
 * Pure + dependency-free, so the API (type-only + value), the worker, and the dapp all
 * share one definition.
 */

export type MilestoneStatus = 'pending' | 'accepted' | 'rejected';

export interface Milestone {
  id: string;
  /** Short human label, e.g. "Draft report". */
  title: string;
  /** What "done" means; the judge scores the delivery against this. */
  criteria: string;
  /** This milestone's share of the step price (USDC). The list sums to the price. */
  amountUsdc: number;
  status: MilestoneStatus;
  /** Advisory judge score 0-5, set on delivery (P2 gates release on acceptance). */
  score?: number;
  /** One-line judge rationale. */
  note?: string;
}

/** A proposed milestone before normalization (planner output or a user edit). */
export interface MilestoneInput {
  title?: unknown;
  criteria?: unknown;
  amountUsdc?: unknown;
}

const ROUND = 1e7; // USDC has 7 on-chain decimals
const round7 = (n: number): number => Math.round(n * ROUND) / ROUND;

function newId(i: number): string {
  return `m${i + 1}`;
}

/** One milestone that is the whole step: the default for a single-deliverable hire. */
export function singleMilestone(title: string, criteria: string, amountUsdc: number): Milestone {
  return { id: 'm1', title, criteria, amountUsdc: round7(amountUsdc), status: 'pending' };
}

/**
 * Validate + normalize a proposed milestone list against a step price: keep entries with
 * a title, clamp negative amounts, and rescale the amounts so they sum EXACTLY to the
 * price (any rounding remainder lands on the last milestone). An empty/invalid proposal
 * becomes a single milestone covering the whole price. Always returns a usable list.
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

  if (cleaned.length === 0) {
    return [singleMilestone(fallbackTitle, '', price)];
  }
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

  // Decide the split: use the proposed amounts if they are all positive, else split evenly.
  const proposedSum = cleaned.reduce((a, m) => a + m.amount, 0);
  const useProposed = proposedSum > 0;
  const weights = useProposed ? cleaned.map((m) => m.amount) : cleaned.map(() => 1);
  const weightSum = weights.reduce((a, w) => a + w, 0);

  let allocated = 0;
  const out: Milestone[] = cleaned.map((m, i) => {
    const isLast = i === cleaned.length - 1;
    // Last milestone absorbs the rounding remainder so the list sums to the price exactly.
    const amt = isLast ? round7(price - allocated) : round7((price * weights[i]) / weightSum);
    allocated = round7(allocated + amt);
    return {
      id: newId(i),
      title: m.title,
      criteria: m.criteria,
      amountUsdc: amt,
      status: 'pending',
    };
  });
  return out;
}

/** Sum of accepted milestones (what P2 is cleared to release). */
export function acceptedTotal(milestones: Milestone[]): number {
  return round7(
    milestones.filter((m) => m.status === 'accepted').reduce((a, m) => a + m.amountUsdc, 0),
  );
}
