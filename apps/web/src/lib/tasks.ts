import { isDemo } from '../config';
import { apiFetch, apiPost } from './api';
import { signTransaction } from './wallet';

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
  output: string | null;
  // When a T2 step is in its dispute window, the moment it auto-releases.
  releaseAt?: string | null;
  // Advisory LLM-judge score (0-5) + one-line rationale; never gates payment.
  qualityRating?: number | null;
  qualityNote?: string | null;
  // A file the provider delivered (downloadable + hash-verifiable).
  artifact?: { url: string; hash: string | null; contentType: string; size: number } | null;
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
  // True while a T2 step is in its dispute window (buyer can approve early / dispute).
  awaitingApproval?: boolean;
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
        output: i < base.completedSteps ? '{"result":"Fulfilled (demo)"}' : null,
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
  // Structured job input for the provider (e.g. { attachment: ArtifactRef }).
  input?: Record<string, unknown>;
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

export interface PaymentLineInput {
  payee: string;
  amount: number;
  reason?: string;
}

export interface AgentPlanResult {
  kind: 'pay' | 'disburse' | 'hire' | 'none';
  lines: PaymentLineInput[];
  service: { id: string; name: string; pricePerCall: number } | null;
  budget: number;
  rationale: string;
  warnings: string[];
  source: 'llm' | 'fallback';
}

/**
 * Parse a natural-language instruction into a structured, pre-validated plan.
 * The agent only proposes; the human approves and the vault enforces limits.
 */
export async function planInstruction(instruction: string): Promise<AgentPlanResult> {
  if (isDemo()) {
    return {
      kind: 'none',
      lines: [],
      service: null,
      budget: 0,
      rationale: 'Connect a wallet (full mode) to use the agent.',
      warnings: [],
      source: 'fallback',
    };
  }
  return apiPost<AgentPlanResult>('/agent/plan', { instruction });
}

/** Raise a dispute on one of the caller's tasks. */
/**
 * Open a dispute on a hired task. The server records it and returns the
 * `raise_dispute` XDR; the buyer signs it and the API submits it, which FREEZES
 * the task on-chain (no further release or completion) until a resolver settles
 * it. The locked budget is the escrow, so nothing is clawed back.
 */
export async function raiseDispute(
  taskId: string,
  reason?: string,
): Promise<{ id: string; status: string }> {
  if (isDemo()) return { id: 'dispute-' + Date.now(), status: 'OPEN' };
  const built = await apiPost<{
    dispute: { id: string; status: string };
    xdr: string;
    networkPassphrase: string;
  }>('/disputes', { taskId, reason });
  const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);
  await apiPost<{ txHash: string }>('/vault/submit', { signedXdr });
  return built.dispute;
}

/**
 * Approve a task's held T2 steps early: accept the delivery before the dispute
 * window elapses so the provider is paid now. Returns how many steps were released.
 */
export async function approveTask(taskId: string): Promise<{ approved: number }> {
  if (isDemo()) return { approved: 1 };
  return apiPost<{ approved: number }>(`/tasks/${taskId}/approve`, {});
}

/** The buyer's disputes, newest first. */
export async function getDisputes(): Promise<
  {
    id: string;
    taskId: string;
    task: string | null;
    status: string;
    reason: string | null;
    resolution: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }[]
> {
  if (isDemo()) return [];
  return apiFetch('/disputes');
}
