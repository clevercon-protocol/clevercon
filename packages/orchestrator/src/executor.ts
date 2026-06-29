/**
 * Orchestrator Execution Engine — U5
 *
 * Groups plan steps by dependency level, executes levels sequentially
 * and steps within a level in parallel.
 *
 * U5 changes:
 * - Accepts per-user orchestrator keypair instead of shared wallet
 * - Calls vault.releasePayment() before each agent payment
 *   (contract → orchestrator USDC, then orchestrator → agent via x402/MPP)
 * - releasePayment calls are serialized within a level to avoid Stellar
 *   sequence-number conflicts when steps run in parallel
 * - Emits budget_released instead of budget_approved
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
import { releasePayment, VAULT_ACTIVE } from './agent-vault-client.js';

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
  // Render free tier cold-starts: service returns 503 immediately, then takes ~50-60s to wake.
  // Poll every 10s for up to ~90s total so we catch the service after it finishes starting.
  const delays = [0, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000]; // 9 attempts, ~80s total wait
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const response = await fetch(agent.health_check, { signal: AbortSignal.timeout(15000) });
      if (response.ok) return true;
      // 503/502 = still sleeping/starting, keep retrying; any 4xx = genuinely down
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

  // Serializes vault releasePayment calls to prevent Stellar sequence conflicts
  private releaseLock: Promise<void> = Promise.resolve();

  constructor(
    availableAgents: AgentRecord[],
    orchestratorKeypair: Keypair | null = null,
    vaultTaskId: bigint | null = null,
  ) {
    super();
    this.agentMap = new Map(availableAgents.map((a) => [a.agent_id, a]));
    this.orchestratorKeypair = orchestratorKeypair;
    this.vaultTaskId = vaultTaskId;
  }

  async execute(
    plan: ExecutionPlan,
    task: string,
    registryUrl: string,
    externalTaskId?: string,
  ): Promise<TaskResult> {
    const task_id = externalTaskId ?? uuidv4();
    const startTime = Date.now();

    this.emit('task_started', { task_id, task, step_count: plan.steps.length });

    const stepResultMap = new Map<number, StepResult>();
    const levels = buildDependencyLevels(plan.steps);
    const stepMap = new Map(plan.steps.map((s) => [s.step_id, s]));

    let allSucceeded = true;
    let anySucceeded = false;

    for (const level of levels) {
      const levelSteps = level.map((id) => stepMap.get(id)!);

      const results = await Promise.all(
        levelSteps.map((step) => this.executeStep(step, task_id, stepResultMap, registryUrl)),
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

  private async executeStep(
    step: ExecutionStep,
    task_id: string,
    previousResults: Map<number, StepResult>,
    _registryUrl: string,
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
      this.emit('step_failed', {
        task_id,
        step_id: step.step_id,
        agent_name: step.agent_name,
        error: result.error!,
      });
      return result;
    }

    const healthy = await checkHealth(agent);
    if (!healthy) {
      const latency_ms = Date.now() - stepStart;
      const result = this.makeFailedResult(
        step,
        `Agent health check failed: ${agent.health_check}`,
        latency_ms,
      );
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

      // ── Vault release: contract → orchestrator (serialized to avoid sequence conflicts)
      let releaseHash: string | null = null;
      if (VAULT_ACTIVE && this.orchestratorKeypair && this.vaultTaskId !== null) {
        const released = await this.releaseSequential(async () => {
          return releasePayment(this.orchestratorKeypair!, this.vaultTaskId!, amountUsdc);
        });

        if (!released) {
          const latency_ms = Date.now() - stepStart;
          const result = this.makeFailedResult(
            step,
            `Vault release failed for step ${step.step_id}`,
            latency_ms,
          );
          this.emit('step_failed', {
            task_id,
            step_id: step.step_id,
            agent_name: step.agent_name,
            error: result.error!,
          });
          return result;
        }

        releaseHash = typeof released === 'string' ? released : null;
        // Wrap emit in try/catch — a serialization error must never kill a step
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

      // ── Agent call: orchestrator → agent (x402 or MPP)
      const orchestratorSecret =
        this.orchestratorKeypair?.secret() ?? process.env.ORCHESTRATOR_SECRET_KEY!;
      let output: string;
      let tx_hash: string | null = null;

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
        // MPP
        const mppResult = await makeMPPPayment(
          agent.endpoint,
          { data: context || '' },
          step.action,
          orchestratorSecret,
        );
        output = mppResult.output;
        tx_hash = mppResult.tx_hash;
      }

      const latency_ms = Date.now() - stepStart;
      const quality_rating = await rateResponse(step.action, output);

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

  private makeFailedResult(step: ExecutionStep, error: string, latency_ms: number): StepResult {
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
