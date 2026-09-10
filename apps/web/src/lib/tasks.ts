import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';

export interface Task {
  id: string;
  title: string;
  mode: string;
  status: string;
  budget: number;
  spent: number;
  stepCount: number;
  completedSteps: number;
  createdAt: string;
}

const demoTasks: Task[] = [
  {
    id: 't-3012',
    title: 'Risk brief on wallet GBUY…4K2',
    mode: 'COMPOSE',
    status: 'RUNNING',
    budget: 2.5,
    spent: 0.85,
    stepCount: 4,
    completedSteps: 2,
    createdAt: '2026-09-06T14:20:00Z',
  },
  {
    id: 't-3009',
    title: 'XLM price snapshot',
    mode: 'DIRECT',
    status: 'COMPLETED',
    budget: 0.1,
    spent: 0.05,
    stepCount: 1,
    completedSteps: 1,
    createdAt: '2026-09-06T11:02:00Z',
  },
  {
    id: 't-3004',
    title: 'Find and pay a research agent',
    mode: 'SEARCH',
    status: 'COMPLETED',
    budget: 0.5,
    spent: 0.1,
    stepCount: 1,
    completedSteps: 1,
    createdAt: '2026-09-05T18:44:00Z',
  },
];

/** The session's tasks: demo data in demo mode, the live API otherwise. */
export async function getTasks(): Promise<Task[]> {
  if (isDemo()) return demoTasks;
  const res = await apiFetch<{ items: Task[] }>('/tasks');
  return res.items;
}

export interface TaskStepView {
  index: number;
  action: string;
  status: string;
  estimatedCost: number;
  service: string | null;
  latencyMs: number | null;
  error: string | null;
}

export interface Receipt {
  id: string;
  amount: number;
  asset: string;
  status: string;
  method: string;
  toAddress: string;
  txHash: string | null;
  createdAt: string;
}

export interface TaskDetail extends Task {
  description: string | null;
  steps: TaskStepView[];
  receipts: Receipt[];
}

/** One task's full detail (steps + receipts): demo synthesises from local data. */
export async function getTask(id: string): Promise<TaskDetail> {
  if (isDemo()) {
    const base = demoTasks.find((t) => t.id === id) ?? demoTasks[0];
    return {
      ...base,
      id,
      description: null,
      steps: Array.from({ length: base.stepCount }, (_, i) => ({
        index: i,
        action: `Step ${i + 1}`,
        status: i < base.completedSteps ? 'RELEASED' : 'PENDING',
        estimatedCost: base.budget / Math.max(base.stepCount, 1),
        service: 'Stellar Oracle',
        latencyMs: i < base.completedSteps ? 820 : null,
        error: null,
      })),
      receipts:
        base.spent > 0
          ? [
              {
                id: 'r-1',
                amount: base.spent,
                asset: 'USDC',
                status: 'CONFIRMED',
                method: 'X402',
                toAddress: 'GSTELLARORACLE000DEMO',
                txHash: 'demo-tx-hash',
                createdAt: base.createdAt,
              },
            ]
          : [],
    };
  }
  return apiFetch<TaskDetail>(`/tasks/${id}`);
}

export type HireMode = 'DIRECT' | 'SEARCH' | 'COMPOSE';

export interface CreateTaskInput {
  title: string;
  mode: HireMode;
  budget: number;
  serviceId?: string;
  policyId?: string;
  description?: string;
}

/** Create a task (hire). In demo mode this returns a local stand-in. */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (isDemo()) {
    return {
      id: 't-' + Date.now(),
      title: input.title,
      mode: input.mode,
      status: 'DRAFT',
      budget: input.budget,
      spent: 0,
      stepCount: input.mode === 'DIRECT' ? 1 : 0,
      completedSteps: 0,
      createdAt: new Date().toISOString(),
    };
  }
  return apiPost<Task>('/tasks', input);
}
