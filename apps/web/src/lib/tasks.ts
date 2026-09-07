import { isDemo } from '../config';
import { apiFetch } from './api';

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
