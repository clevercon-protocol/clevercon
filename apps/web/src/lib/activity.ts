import { isDemo } from '../config';
import { apiFetch } from './api';
import { demoJobs } from './demo';

export type ActivityKind =
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'payment';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  amount?: number;
  asset?: string;
  status?: string;
  txHash?: string | null;
  taskId?: string;
  at: string;
}

/** The buyer's activity timeline: demo data in demo mode, the live API otherwise. */
export async function getActivity(): Promise<ActivityItem[]> {
  if (isDemo()) {
    // Synthesize a plausible feed from the demo jobs so the page is not empty.
    const now = Date.now();
    return demoJobs.map((j, i) => ({
      id: `demo-${j.id}`,
      kind: j.status === 'completed' ? 'task_completed' : 'task_created',
      title: j.status === 'completed' ? `Job completed: ${j.service}` : `Job created: ${j.service}`,
      amount: j.amountUsdc,
      asset: 'USDC',
      taskId: j.id,
      at: new Date(now - i * 6 * 60_000).toISOString(),
    }));
  }
  return apiFetch<ActivityItem[]>('/activity');
}
