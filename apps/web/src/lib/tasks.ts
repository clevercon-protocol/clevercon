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

export type HireMode = 'DIRECT' | 'SEARCH' | 'COMPOSE';

export interface CreateTaskInput {
  title: string;
  mode: HireMode;
  budget: number;
  serviceId?: string;
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
