/**
 * Task Results store — persists completed task results per user for the History tab.
 * Saves the input prompt + full TaskResult so History can show real output and receipts.
 *
 * Uses atomic rename writes to prevent corruption on process crash.
 */

import fs from 'fs';
import path from 'path';
import type { TaskResult } from '@clevercon/common';
import { writeJsonSafe } from '@clevercon/common';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const RESULTS_PATH = path.join(DATA_DIR, 'task-results.json');

export interface TaskResultEntry {
  task_id: string;
  user_address: string;
  prompt: string; // original user input (truncated to 500 chars on save)
  status: 'complete' | 'partial' | 'failed';
  total_cost: number;
  total_time_ms: number;
  final_output: string | null;
  steps: TaskResult['steps'];
  timestamp: string;
}

type Store = TaskResultEntry[];

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(RESULTS_PATH)) fs.writeFileSync(RESULTS_PATH, '[]', 'utf8');
    cache = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) as Store;
  } catch {
    cache = [];
  }
  return cache;
}

function save(store: Store): void {
  const trimmed = store.slice(-500); // cap at 500 entries
  writeJsonSafe(RESULTS_PATH, trimmed);
  cache = trimmed;
}

export function saveTaskResult(
  userAddress: string,
  prompt: string,
  result: TaskResult,
): TaskResultEntry {
  const store = load();
  // Overwrite if task_id already exists (idempotent)
  const existing = store.findIndex((e) => e.task_id === result.task_id);
  const entry: TaskResultEntry = {
    task_id: result.task_id,
    user_address: userAddress,
    prompt: prompt.slice(0, 500),
    status: result.status,
    total_cost: result.total_cost,
    total_time_ms: result.total_time_ms,
    final_output: result.final_output,
    steps: result.steps,
    timestamp: new Date().toISOString(),
  };
  if (existing >= 0) {
    store[existing] = entry;
  } else {
    store.push(entry);
  }
  save(store);
  return entry;
}

export function getTaskResults(userAddress: string, limit = 50): TaskResultEntry[] {
  const store = load();
  return store
    .filter((e) => e.user_address === userAddress)
    .slice(-limit)
    .reverse();
}

export function deleteTaskResult(taskId: string): boolean {
  const store = load();
  const before = store.length;
  save(store.filter((e) => e.task_id !== taskId));
  return store.length !== before;
}

export function clearTaskResults(): void {
  save([]);
}
