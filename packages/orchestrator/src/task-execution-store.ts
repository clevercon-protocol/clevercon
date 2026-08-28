/**
 * Task Execution Store — persists durable execution state per task and per step in data/task-executions.json.
 *
 * Implements durable state transitions for the crash-safe, resumable executor:
 * pending -> executing -> delivered -> releasing -> released | failed
 *
 * Uses atomic rename writes (writeJsonSafe) to prevent data corruption on process crash or restart.
 */

import fs from 'fs';
import path from 'path';
import type { ExecutionPlan } from '@clevercon/common';
import { writeJsonSafe } from '@clevercon/common';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'task-executions.json');

export type StepExecutionStatus =
  | 'pending'
  | 'executing'
  | 'delivered'
  | 'releasing'
  | 'released'
  | 'failed';

export interface DurableStepState {
  step_id: number;
  agent_id: string;
  agent_name: string;
  action: string;
  payment_method: 'x402' | 'mpp';
  amount_usdc: number;
  status: StepExecutionStatus;
  output: string | null;
  error: string | null;
  tx_hash: string | null;
  vault_release_hash: string | null;
  quality_rating: number | null;
  latency_ms: number | null;
  attempts: number;
  updated_at: string;
}

export type TaskExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface DurableTaskState {
  task_id: string;
  user_address: string | null;
  task: string;
  budget: number;
  status: TaskExecutionStatus;
  plan: ExecutionPlan;
  vault_task_id: number | null;
  created_at: string;
  updated_at: string;
  step_states: Record<number, DurableStepState>;
  final_output: string | null;
  total_cost: number;
  total_time_ms: number;
  webhook_url?: string;
}

type Store = Record<string, DurableTaskState>; // Keyed by task_id

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, '{}', 'utf8');
    }
    cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

function save(store: Store): void {
  writeJsonSafe(STORE_PATH, store);
  cache = store;
}

export function initTaskExecution(
  task_id: string,
  task: string,
  budget: number,
  plan: ExecutionPlan,
  user_address: string | null = null,
  vault_task_id: number | null = null,
  webhook_url?: string,
): DurableTaskState {
  const store = load();
  const now = new Date().toISOString();

  const step_states: Record<number, DurableStepState> = {};
  for (const step of plan.steps) {
    step_states[step.step_id] = {
      step_id: step.step_id,
      agent_id: step.agent_id,
      agent_name: step.agent_name,
      action: step.action,
      payment_method: step.payment_method,
      amount_usdc: step.estimated_cost,
      status: 'pending',
      output: null,
      error: null,
      tx_hash: null,
      vault_release_hash: null,
      quality_rating: null,
      latency_ms: null,
      attempts: 0,
      updated_at: now,
    };
  }

  const record: DurableTaskState = {
    task_id,
    user_address,
    task,
    budget,
    status: 'running',
    plan,
    vault_task_id,
    created_at: now,
    updated_at: now,
    step_states,
    final_output: null,
    total_cost: 0,
    total_time_ms: 0,
    webhook_url,
  };

  store[task_id] = record;
  save(store);
  return record;
}

export function getTaskExecution(task_id: string): DurableTaskState | null {
  return load()[task_id] ?? null;
}

export function getAllTaskExecutions(): DurableTaskState[] {
  return Object.values(load());
}

export function getUnfinishedTaskExecutions(): DurableTaskState[] {
  return Object.values(load()).filter(
    (t) => t.status === 'running' || t.status === 'pending',
  );
}

export function updateTaskState(
  task_id: string,
  update: Partial<DurableTaskState>,
): DurableTaskState | null {
  const store = load();
  const existing = store[task_id];
  if (!existing) return null;

  const updated: DurableTaskState = {
    ...existing,
    ...update,
    updated_at: new Date().toISOString(),
  };

  store[task_id] = updated;
  save(store);
  return updated;
}

export function updateStepState(
  task_id: string,
  step_id: number,
  update: Partial<DurableStepState>,
): DurableStepState | null {
  const store = load();
  const existingTask = store[task_id];
  if (!existingTask || !existingTask.step_states[step_id]) return null;

  const existingStep = existingTask.step_states[step_id];
  const updatedStep: DurableStepState = {
    ...existingStep,
    ...update,
    updated_at: new Date().toISOString(),
  };

  existingTask.step_states[step_id] = updatedStep;
  existingTask.updated_at = new Date().toISOString();
  store[task_id] = existingTask;
  save(store);
  return updatedStep;
}

export function deleteTaskExecution(task_id: string): boolean {
  const store = load();
  if (store[task_id]) {
    delete store[task_id];
    save(store);
    return true;
  }
  return false;
}

export function clearTaskExecutions(): void {
  save({});
}
