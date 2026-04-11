/**
 * Activity store — persists per-user orchestrator activity in data/activity-log.json.
 *
 * Events are appended in order. The API returns the most recent N for a user.
 */

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'activity-log.json');

export type ActivityEventType =
  | 'task_started'
  | 'budget_locked'
  | 'payment_released'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled';

export interface ActivityEvent {
  id: string;
  user_address: string;
  event: ActivityEventType;
  task_id: string;
  task_description?: string;
  amount_usdc?: number;
  agent_name?: string;
  tx_hash?: string;
  vault_task_id?: number;
  timestamp: string;
}

type Log = ActivityEvent[];

let cache: Log | null = null;

function load(): Log {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LOG_PATH)) {
      fs.writeFileSync(LOG_PATH, '[]', 'utf8');
    }
    cache = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) as Log;
  } catch {
    cache = [];
  }
  return cache;
}

function save(log: Log): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Keep at most 1000 entries globally
  const trimmed = log.slice(-1000);
  fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  cache = trimmed;
}

let _seq = 0;
function nextId(): string {
  return `act_${Date.now()}_${++_seq}`;
}

export function append(event: Omit<ActivityEvent, 'id' | 'timestamp'>): ActivityEvent {
  const log = load();
  const entry: ActivityEvent = {
    ...event,
    id: nextId(),
    timestamp: new Date().toISOString(),
  };
  log.push(entry);
  save(log);
  return entry;
}

export function getForUser(userAddress: string, limit = 50): ActivityEvent[] {
  const log = load();
  return log
    .filter(e => e.user_address === userAddress)
    .slice(-limit)
    .reverse();
}

export interface PulseStats {
  total_tasks: number;
  total_completed: number;
  total_failed: number;
  active_tasks: number;
  total_spent_usdc: number;
  most_hired_agent: string | null;
  recent_completions: Array<{
    task_description: string;
    amount_usdc: number;
    timestamp: string;
  }>;
}

export function getPulse(): PulseStats {
  const log = load();
  const started = log.filter(e => e.event === 'task_started');
  const completed = log.filter(e => e.event === 'task_completed');
  const failed = log.filter(e => e.event === 'task_failed');

  // Active = started but not yet completed or failed
  const finishedIds = new Set([...completed, ...failed].map(e => e.task_id));
  const active = started.filter(e => !finishedIds.has(e.task_id));

  // Total spent
  const payments = log.filter(e => e.event === 'payment_released' && e.amount_usdc);
  const totalSpent = payments.reduce((sum, e) => sum + (e.amount_usdc ?? 0), 0);

  // Most hired agent
  const agentCounts = new Map<string, number>();
  for (const p of payments) {
    if (p.agent_name) agentCounts.set(p.agent_name, (agentCounts.get(p.agent_name) ?? 0) + 1);
  }
  let mostHired: string | null = null;
  let maxCount = 0;
  for (const [name, count] of agentCounts) {
    if (count > maxCount) { mostHired = name; maxCount = count; }
  }

  // Recent completions
  const recentCompletions = completed
    .slice(-5)
    .reverse()
    .map(e => ({
      task_description: e.task_description ?? '(unknown)',
      amount_usdc: e.amount_usdc ?? 0,
      timestamp: e.timestamp,
    }));

  return {
    total_tasks: started.length,
    total_completed: completed.length,
    total_failed: failed.length,
    active_tasks: active.length,
    total_spent_usdc: totalSpent,
    most_hired_agent: mostHired,
    recent_completions: recentCompletions,
  };
}
