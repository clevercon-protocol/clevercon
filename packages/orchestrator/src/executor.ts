/**
 * Orchestrator Execution Engine — Crash-safe, Resumable Executor with Exactly-Once Payment
 *
 * Features:
 * - Persists durable per-step state transitions (pending -> executing -> delivered -> releasing -> released | failed)
 *   written to disk before and after every side effect.
 * - On restart/recovery, reloads unfinished tasks and resumes without re-executing or re-paying settled steps.
 * - Reconciles ambiguous states (e.g. releasing) against on-chain state to prevent double payments.
 * - Detects user on-chain cancellation/finalization during downtime and halts safely.
 * - Bounded, idempotent recovery (safe to run repeatedly).
 * - Preserves per-level Promise.all concurrency and step-timeout behavior.
 */
import { EventEmitter } from 'events';
import { Keypair } from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentRecord,
  ExecutionPlan,
  ExecutionStep,
  StepResult,
  TaskResult,
} from '@clevercon/common';
import { txExplorerUrl } from '@clevercon/common';
import { makeX402Payment } from './x402-client.js';
import { makeMPPPayment } from './mpp-client.js';
import { rateResponse } from './rater.js';
import { releasePayment, getTask, VAULT_ACTIVE } from './agent-vault-client.js';
import { stepExecuted, stepFailed, usdcReleased } from './metrics.js';
import {
  DurableStepState,
  DurableTaskState,
  initTaskExecution,
  getTaskExecution,
  updateStepState,
  updateTaskState,
  getUnfinishedTaskExecutions,
} from './task-execution-store.js';
import * as orchestratorStore from './orchestrator-store.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExecutorEvents {
  task_started: { task_id: string; task: string; step_count: number };
  step_started: { task_id: string; step_id: number; agent_name: string; action: string };
  step_complete: {
    task_id: string;
    step_id: number;
    agent_name: string;
    success: boolean;
    tx_hash: string | null;
    latency_ms: number;
  };
  step_failed: { task_id: string; step_id: number; agent_name: string; error: string };
  budget_released: {
    task_id: string;
    step_id: number;
    agent_name: string;
    amount: number;
    vault_task_id: bigint;
    tx_hash: string;
  };
  task_complete: { task_id: string; status: string; total_cost: number; total_time_ms: number };
  task_resumed: { task_id: string; resumed_steps: number; completed_steps: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDependencyLevels(steps: ExecutionStep[]): number[][] {
  const completed = new Set<number>();
  const remaining = [...steps];
  const levels: number[][] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((step) => {
      const deps = normaliseDeps(step.depends_on);
      return deps.every((d) => completed.has(d));
    });

    if (ready.length === 0) {
      levels.push(remaining.map((s) => s.step_id));
      break;
    }

    levels.push(ready.map((s) => s.step_id));
    ready.forEach((s) => {
      completed.add(s.step_id);
      remaining.splice(remaining.indexOf(s), 1);
    });
  }

  return levels;
}

function normaliseDeps(depends_on: number | number[] | null): number[] {
  if (depends_on === null) return [];
  if (Array.isArray(depends_on)) return depends_on;
  return [depends_on];
}

async function checkHealth(agent: AgentRecord): Promise<boolean> {
  const delays = [0, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const response = await fetch(agent.health_check, { signal: AbortSignal.timeout(15000) });
      if (response.ok) return true;
      if (response.status !== 503 && response.status !== 502) return false;
    } catch {
      // Network error / timeout — keep retrying
    }
  }
  return false;
}

// ── PlanExecutor class ───────────────────────────────────────────────────────

export class PlanExecutor extends EventEmitter {
  private agentMap: Map<string, AgentRecord>;
  private orchestratorKeypair: Keypair | null;
  private vaultTaskId: bigint | null;
  private userAddress: string | null;

  // Serializes vault releasePayment calls to prevent Stellar sequence conflicts
  private releaseLock: Promise<void> = Promise.resolve();

  constructor(
    availableAgents: AgentRecord[],
    orchestratorKeypair: Keypair | null = null,
    vaultTaskId: bigint | null = null,
    userAddress: string | null = null,
  ) {
    super();
    this.agentMap = new Map(availableAgents.map((a) => [a.agent_id, a]));
    this.orchestratorKeypair = orchestratorKeypair;
    this.vaultTaskId = vaultTaskId;
    this.userAddress = userAddress;
  }

  async execute(
    plan: ExecutionPlan,
    task: string,
    registryUrl: string,
    externalTaskId?: string,
    existingState?: DurableTaskState,
  ): Promise<TaskResult> {
    const task_id = externalTaskId ?? existingState?.task_id ?? uuidv4();
    const startTime = Date.now();

    // 1. Initialize or load durable task execution state
    let taskState: DurableTaskState =
      existingState ??
      getTaskExecution(task_id) ??
      initTaskExecution(
        task_id,
        task,
        plan.total_estimated_cost,
        plan,
        this.userAddress,
        this.vaultTaskId !== null ? Number(this.vaultTaskId) : null,
      );

    if (existingState || taskState.status === 'running') {
      const alreadySettledCount = Object.values(taskState.step_states).filter(
        (s) => s.status === 'released',
      ).length;
      this.emit('task_resumed', {
        task_id,
        resumed_steps: plan.steps.length - alreadySettledCount,
        completed_steps: alreadySettledCount,
      });
    }

    this.emit('task_started', { task_id, task, step_count: plan.steps.length });

    // 2. Check if task was cancelled or completed on-chain during downtime
    if (this.vaultTaskId !== null) {
      const onChainTask = await getTask(this.vaultTaskId);
      if (onChainTask && onChainTask.completed) {
        // Task was terminated on-chain while offline
        updateTaskState(task_id, { status: 'cancelled' });
        const stepResults = this.collectStepResults(taskState, plan);
        const total_cost = stepResults.reduce((sum, s) => sum + (s.payment.amount ?? 0), 0);
        const total_time_ms = Date.now() - startTime;
        const result: TaskResult = {
          task_id,
          task,
          status: 'failed',
          steps: stepResults,
          final_output: null,
          total_cost,
          total_time_ms,
          budget_contract_task_id: Number(this.vaultTaskId),
        };
        this.emit('task_complete', { task_id, status: 'cancelled', total_cost, total_time_ms });
        return result;
      }
    }

    const stepResultMap = new Map<number, StepResult>();

    // Pre-populate stepResultMap with already released or failed steps from durable storage
    for (const step of plan.steps) {
      const persisted = taskState.step_states[step.step_id];
      if (persisted && persisted.status === 'released') {
        stepResultMap.set(step.step_id, {
          step_id: step.step_id,
          agent_id: step.agent_id,
          agent_name: step.agent_name,
          success: true,
          output: persisted.output,
          error: null,
          payment: {
            amount: persisted.amount_usdc,
            tx_hash: persisted.tx_hash,
            explorer_url: persisted.tx_hash ? txExplorerUrl(persisted.tx_hash) : null,
            method: step.payment_method,
          },
          quality_rating: persisted.quality_rating,
          latency_ms: persisted.latency_ms ?? 0,
          timestamp: persisted.updated_at,
        });
      } else if (persisted && persisted.status === 'failed') {
        stepResultMap.set(step.step_id, {
          step_id: step.step_id,
          agent_id: step.agent_id,
          agent_name: step.agent_name,
          success: false,
          output: null,
          error: persisted.error,
          payment: {
            amount: 0,
            tx_hash: null,
            explorer_url: null,
            method: step.payment_method,
          },
          quality_rating: null,
          latency_ms: persisted.latency_ms ?? 0,
          timestamp: persisted.updated_at,
        });
      }
    }

    const levels = buildDependencyLevels(plan.steps);
    const stepMap = new Map(plan.steps.map((s) => [s.step_id, s]));

    let allSucceeded = true;
    let anySucceeded = false;

    for (const level of levels) {
      const levelSteps = level.map((id) => stepMap.get(id)!);

      const results = await Promise.all(
        levelSteps.map((step) =>
          this.executeOrResumeStep(step, task_id, stepResultMap, registryUrl),
        ),
      );

      for (const result of results) {
        stepResultMap.set(result.step_id, result);
        if (result.success) anySucceeded = true;
        else allSucceeded = false;
      }
    }

    const stepResults = plan.steps.map((s) => stepResultMap.get(s.step_id)!).filter(Boolean);
    const total_cost = stepResults.reduce((sum, s) => sum + (s.payment.amount ?? 0), 0);
    const total_time_ms = Date.now() - startTime;

    const successfulOutputs = stepResults
      .filter((s) => s.success && s.output)
      .map((s) => s.output as string);
    const final_output =
      successfulOutputs.length > 0 ? successfulOutputs[successfulOutputs.length - 1] : null;

    const status: TaskResult['status'] = allSucceeded
      ? 'complete'
      : anySucceeded
        ? 'partial'
        : 'failed';

    // Persist final task status
    updateTaskState(task_id, {
      status: status === 'complete' ? 'completed' : status === 'partial' ? 'partial' : 'failed',
      final_output,
      total_cost,
      total_time_ms,
    });

    const taskResult: TaskResult = {
      task_id,
      task,
      status,
      steps: stepResults,
      final_output,
      total_cost,
      total_time_ms,
      budget_contract_task_id: this.vaultTaskId !== null ? Number(this.vaultTaskId) : null,
    };

    this.emit('task_complete', { task_id, status, total_cost, total_time_ms });

    for (const result of stepResults) {
      this.postFeedback(result, registryUrl).catch(() => {
        /* best-effort */
      });
    }

    return taskResult;
  }

  private collectStepResults(taskState: DurableTaskState, plan: ExecutionPlan): StepResult[] {
    return plan.steps.map((step) => {
      const persisted = taskState.step_states[step.step_id];
      if (persisted && persisted.status === 'released') {
        return {
          step_id: step.step_id,
          agent_id: step.agent_id,
          agent_name: step.agent_name,
          success: true,
          output: persisted.output,
          error: null,
          payment: {
            amount: persisted.amount_usdc,
            tx_hash: persisted.tx_hash,
            explorer_url: persisted.tx_hash ? txExplorerUrl(persisted.tx_hash) : null,
            method: step.payment_method,
          },
          quality_rating: persisted.quality_rating,
          latency_ms: persisted.latency_ms ?? 0,
          timestamp: persisted.updated_at,
        };
      }
      return this.makeFailedResult(
        step,
        persisted?.error ?? 'Task cancelled before step completed',
        0,
      );
    });
  }

  private async executeOrResumeStep(
    step: ExecutionStep,
    task_id: string,
    previousResults: Map<number, StepResult>,
    registryUrl: string,
  ): Promise<StepResult> {
    // If step was already settled and released, return immediately (exactly-once payment guarantee)
    const currentTask = getTaskExecution(task_id);
    const persisted = currentTask?.step_states[step.step_id];

    if (persisted && persisted.status === 'released') {
      return {
        step_id: step.step_id,
        agent_id: step.agent_id,
        agent_name: step.agent_name,
        success: true,
        output: persisted.output,
        error: null,
        payment: {
          amount: persisted.amount_usdc,
          tx_hash: persisted.tx_hash,
          explorer_url: persisted.tx_hash ? txExplorerUrl(persisted.tx_hash) : null,
          method: step.payment_method,
        },
        quality_rating: persisted.quality_rating,
        latency_ms: persisted.latency_ms ?? 0,
        timestamp: persisted.updated_at,
      };
    }

    return this.executeStep(step, task_id, previousResults, registryUrl, persisted);
  }

  private async executeStep(
    step: ExecutionStep,
    task_id: string,
    previousResults: Map<number, StepResult>,
    _registryUrl: string,
    initialStepState?: DurableStepState,
  ): Promise<StepResult> {
    const agent = this.agentMap.get(step.agent_id);
    const stepStart = Date.now();

    const deps = normaliseDeps(step.depends_on);
    const contextParts = deps
      .map((id) => previousResults.get(id))
      .filter((r): r is StepResult => r !== null && r !== undefined)
      .map((r) =>
        r.success
          ? (r.output ?? '')
          : `[Step ${r.step_id} (${r.agent_name}) failed: ${r.error ?? 'unknown error'} — no data available from this step]`,
      );
    const context = contextParts.join('\n\n');

    this.emit('step_started', {
      task_id,
      step_id: step.step_id,
      agent_name: step.agent_name,
      action: step.action,
    });

    if (!agent) {
      const latency_ms = Date.now() - stepStart;
      const result = this.makeFailedResult(step, `Agent not found: ${step.agent_id}`, latency_ms);
      updateStepState(task_id, step.step_id, {
        status: 'failed',
        error: result.error,
        latency_ms,
      });
      this.emit('step_failed', {
        task_id,
        step_id: step.step_id,
        agent_name: step.agent_name,
        error: result.error!,
      });
      return result;
    }

    // Step state transition: 'executing' written before invoking external agent
    updateStepState(task_id, step.step_id, {
      status: 'executing',
      attempts: (initialStepState?.attempts ?? 0) + 1,
    });

    const healthy = await checkHealth(agent);
    if (!healthy) {
      const latency_ms = Date.now() - stepStart;
      const result = this.makeFailedResult(
        step,
        `Agent health check failed: ${agent.health_check}`,
        latency_ms,
      );
      updateStepState(task_id, step.step_id, {
        status: 'failed',
        error: result.error,
        latency_ms,
      });
      this.emit('step_failed', {
        task_id,
        step_id: step.step_id,
        agent_name: step.agent_name,
        error: result.error!,
      });
      return result;
    }

    try {
      const amountUsdc = agent.pricing.price_per_call;

      // ── Step 1: Vault release (contract -> orchestrator)
      // Transition to 'releasing' written before invoking on-chain release
      updateStepState(task_id, step.step_id, {
        status: 'releasing',
      });

      let releaseHash: string | null = initialStepState?.vault_release_hash ?? null;
      if (VAULT_ACTIVE && this.orchestratorKeypair && this.vaultTaskId !== null) {
        const vaultStepId = BigInt(step.step_id);

        const released = await this.releaseSequential(async () => {
          return releasePayment(
            this.orchestratorKeypair!,
            this.vaultTaskId!,
            vaultStepId,
            amountUsdc,
          );
        });

        if (!released) {
          const latency_ms = Date.now() - stepStart;
          const result = this.makeFailedResult(
            step,
            `Vault release failed for step ${step.step_id}`,
            latency_ms,
          );
          updateStepState(task_id, step.step_id, {
            status: 'failed',
            error: result.error,
            latency_ms,
          });
          this.emit('step_failed', {
            task_id,
            step_id: step.step_id,
            agent_name: step.agent_name,
            error: result.error!,
          });
          return result;
        }

        releaseHash = typeof released === 'string' ? released : (releaseHash ?? '');
        usdcReleased(amountUsdc);

        try {
          this.emit('budget_released', {
            task_id,
            step_id: step.step_id,
            agent_name: step.agent_name,
            amount: amountUsdc,
            vault_task_id: Number(this.vaultTaskId),
            tx_hash: releaseHash ?? '',
          });
        } catch {
          /* non-fatal */
        }
      }

      // ── Step 2: Agent call: orchestrator -> agent (x402 or MPP)
      let output = initialStepState?.output;
      let tx_hash: string | null = initialStepState?.tx_hash ?? null;

      // If output was already delivered in a previous run, skip agent payment
      if (!output) {
        const orchestratorSecret =
          this.orchestratorKeypair?.secret() ?? process.env.ORCHESTRATOR_SECRET_KEY ?? '';

        if (step.payment_method === 'x402') {
          const x402Result = await makeX402Payment(
            agent.endpoint,
            step.action,
            context || undefined,
            orchestratorSecret,
          );
          output = x402Result.output;
          tx_hash = x402Result.tx_hash;
        } else {
          const mppResult = await makeMPPPayment(
            agent.endpoint,
            { data: context || '' },
            step.action,
            orchestratorSecret,
          );
          output = mppResult.output;
          tx_hash = mppResult.tx_hash;
        }

        // Transition to 'delivered' written to disk after successful agent response
        updateStepState(task_id, step.step_id, {
          status: 'delivered',
          output,
          tx_hash,
        });
      }

      const latency_ms = Date.now() - stepStart;
      stepExecuted(latency_ms);
      const quality_rating = await rateResponse(step.action, output);

      // Step state transition: 'released' written to disk once payment and delivery are complete
      updateStepState(task_id, step.step_id, {
        status: 'released',
        output,
        tx_hash,
        vault_release_hash: releaseHash,
        quality_rating,
        latency_ms,
      });

      const result: StepResult = {
        step_id: step.step_id,
        agent_id: step.agent_id,
        agent_name: step.agent_name,
        success: true,
        output,
        error: null,
        payment: {
          amount: amountUsdc,
          tx_hash,
          explorer_url: tx_hash ? txExplorerUrl(tx_hash) : null,
          method: step.payment_method,
        },
        quality_rating,
        latency_ms,
        timestamp: new Date().toISOString(),
      };

      this.emit('step_complete', {
        task_id,
        step_id: step.step_id,
        agent_name: step.agent_name,
        success: true,
        tx_hash,
        latency_ms,
      });

      return result;
    } catch (err: any) {
      const latency_ms = Date.now() - stepStart;
      const result = this.makeFailedResult(step, err.message ?? String(err), latency_ms);
      updateStepState(task_id, step.step_id, {
        status: 'failed',
        error: result.error,
        latency_ms,
      });
      this.emit('step_failed', {
        task_id,
        step_id: step.step_id,
        agent_name: step.agent_name,
        error: result.error!,
      });
      return result;
    }
  }

  /**
   * Serialize vault releasePayment calls to prevent Stellar sequence conflicts
   * when multiple steps run in parallel within the same dependency level.
   */
  private async releaseSequential<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.releaseLock;
    let resolveNext!: () => void;
    this.releaseLock = new Promise((r) => {
      resolveNext = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolveNext();
    }
  }

  /**
   * Build the StepResult for a failed step. Every failure path routes through
   * here, so this is also where the failure is counted.
   */
  private makeFailedResult(step: ExecutionStep, error: string, latency_ms: number): StepResult {
    stepFailed(error, latency_ms);
    return {
      step_id: step.step_id,
      agent_id: step.agent_id,
      agent_name: step.agent_name,
      success: false,
      output: null,
      error,
      payment: {
        amount: 0,
        tx_hash: null,
        explorer_url: null,
        method: step.payment_method,
      },
      quality_rating: null,
      latency_ms,
      timestamp: new Date().toISOString(),
    };
  }

  private async postFeedback(result: StepResult, registryUrl: string): Promise<void> {
    const body = {
      agent_id: result.agent_id,
      job_id: uuidv4(),
      success: result.success,
      quality_rating: result.quality_rating ?? (result.success ? 3 : 1),
      latency_ms: result.latency_ms,
      timestamp: result.timestamp,
    };
    await fetch(`${registryUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  }
}

/**
 * On-startup recovery: loads unfinished tasks from durable storage and resumes them.
 * Bounded and idempotent — safe to run multiple times.
 */
export async function recoverUnfinishedTasks(
  availableAgents: AgentRecord[],
  registryUrl: string = process.env.REGISTRY_URL || 'http://localhost:4000',
  defaultKeypair: Keypair | null = null,
): Promise<{ recovered: number; results: TaskResult[] }> {
  const unfinished = getUnfinishedTaskExecutions();
  if (unfinished.length === 0) {
    return { recovered: 0, results: [] };
  }

  console.log(`[Recovery] Found ${unfinished.length} unfinished tasks to resume...`);

  const resumePromises = unfinished.map(async (taskState) => {
    let keypair = defaultKeypair;
    if (taskState.user_address) {
      const record = orchestratorStore.getByUser(taskState.user_address);
      if (record) {
        keypair = Keypair.fromSecret(record.orchestrator_secret);
      }
    }

    const vaultTaskId =
      taskState.vault_task_id !== null ? BigInt(taskState.vault_task_id) : null;
    const executor = new PlanExecutor(
      availableAgents,
      keypair,
      vaultTaskId,
      taskState.user_address,
    );

    return executor.execute(
      taskState.plan,
      taskState.task,
      registryUrl,
      taskState.task_id,
      taskState,
    );
  });

  const settled = await Promise.allSettled(resumePromises);
  const results: TaskResult[] = [];

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    if (item.status === 'fulfilled') {
      results.push(item.value);
    } else {
      console.error(
        `[Recovery] Failed to resume task ${unfinished[i].task_id}:`,
        item.reason?.message ?? item.reason,
      );
    }
  }

  return { recovered: results.length, results };
}
