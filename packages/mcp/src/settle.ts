/**
 * Settle a delivered hire through the buyer's own rule path, the SAME rails a direct
 * spend uses: a private rule releases KEYLESS (prove locally, relay the proof), a
 * public rule pays via the Managed Session. This is the server-side equivalent of the
 * dapp JobCard: when a hired step is delivered (RELEASED) and unpaid, pay the provider
 * under the rule, and the server records the step-linked payment (hire meta), so the
 * provider is marked paid. The agent holds the key, so it can prove, exactly like
 * disburse_private.
 *
 * A hire pays ONLY after delivery + acceptance (the step is RELEASED), so the agent
 * never pays up front and never pays for a non-delivery.
 */
import { createApiClient, type ApiConfig } from './api-client.js';
import { relayKeylessDisbursement, hasPrivatePolicy, type KeylessLine } from './keyless-relay.js';

interface Step {
  id: string;
  status: string;
  paid?: boolean;
  payee?: string | null;
  estimatedCost: number;
  // The amount actually owed on release (accepted-milestone aware): the server sets
  // this to the accepted total once a judged hire's milestones are decided. Settle this.
  settlementUsdc?: number;
}
interface TaskDetail {
  id: string;
  status: string;
  steps: Step[];
}

const NON_TERMINAL = new Set(['PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'INPUT_REQUIRED']);

/** The provider payout owed for a delivered step: the accepted-milestone total the
 *  server computed, falling back to the full price for a plain (un-milestoned) step. */
function owedUsdc(s: Step): number {
  return Number(s.settlementUsdc ?? s.estimatedCost);
}

export interface SettleSummary {
  taskId: string;
  settled: number;
  lane?: 'private' | 'public';
  totalUsdc?: number;
  results?: unknown[];
  pending?: boolean;
  note: string;
}

/** Steps that are delivered-and-unpaid: RELEASED, not yet paid, with a payee and a
 *  non-zero owed amount (a fully-rejected step owes nothing and is already settled). */
function unpaidReleased(task: TaskDetail): Step[] {
  return task.steps.filter(
    (s) => s.status === 'RELEASED' && !s.paid && !!s.payee && owedUsdc(s) > 0,
  );
}

/**
 * Pay every delivered-and-unpaid step of a hire under the configured rule. Private
 * groups up to 4 payees per proof; public pays each via the Managed Session. Safe to
 * call repeatedly: already-paid steps are skipped and the server dedupes by step.
 */
export async function settleHireTask(config: ApiConfig, taskId: string): Promise<SettleSummary> {
  const client = createApiClient(config);
  const task = await client.get<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
  const unpaid = unpaidReleased(task);

  if (unpaid.length === 0) {
    const stillOpen = task.steps.some((s) => NON_TERMINAL.has(s.status));
    return {
      taskId,
      settled: 0,
      pending: stillOpen,
      note: stillOpen
        ? 'No delivered-and-unpaid step yet (the job is not RELEASED). Poll get_task and settle once it is accepted.'
        : 'Nothing to settle: every step is already paid or terminal.',
    };
  }

  const results: unknown[] = [];
  const lane: 'private' | 'public' = hasPrivatePolicy() ? 'private' : 'public';

  if (lane === 'private') {
    // One keyless proof per up-to-4 payees, carrying hire meta so the server records
    // a step-linked payment after the on-chain release.
    for (let i = 0; i < unpaid.length; i += 4) {
      const group = unpaid.slice(i, i + 4);
      const lines: KeylessLine[] = group.map((s) => ({
        payee: s.payee as string,
        amount: owedUsdc(s),
      }));
      const res = await relayKeylessDisbursement(client, lines, {
        taskId,
        stepIds: group.map((s) => s.id),
      });
      results.push({ stepIds: group.map((s) => s.id), ...res });
    }
  } else {
    // Public: pay each provider via the Managed Session; the server records the
    // step-linked payment via the hire meta.
    for (const s of unpaid) {
      const res = await client.post('/vault/session/pay', {
        payee: s.payee,
        amount: owedUsdc(s),
        hire: { taskId, stepId: s.id },
      });
      results.push({
        stepId: s.id,
        payee: s.payee,
        amountUsdc: owedUsdc(s),
        result: res,
      });
    }
  }

  const totalUsdc = unpaid.reduce((a, s) => a + owedUsdc(s), 0);
  return {
    taskId,
    settled: unpaid.length,
    lane,
    totalUsdc,
    results,
    note:
      lane === 'private'
        ? 'Settled keyless under your private rule (proof verified on-chain); the provider is now paid.'
        : 'Settled via your Managed Session under the public rule; the provider is now paid.',
  };
}

export { unpaidReleased, NON_TERMINAL };
export type { Step as HireStep, TaskDetail as HireTaskDetail };
