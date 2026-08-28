/**
 * Vitest tests for Crash-safe, Resumable Executor with Exactly-Once Payment (Issue #106)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AgentRecord, ExecutionPlan } from '@clevercon/common';
import { PlanExecutor, recoverUnfinishedTasks } from '../executor.js';
import * as taskExecutionStore from '../task-execution-store.js';
import * as agentVaultClient from '../agent-vault-client.js';
import * as x402Client from '../x402-client.js';
import * as mppClient from '../mpp-client.js';

// Mock dependencies
vi.mock('../x402-client.js', () => ({
  makeX402Payment: vi.fn(),
}));

vi.mock('../mpp-client.js', () => ({
  makeMPPPayment: vi.fn(),
}));

vi.mock('../rater.js', () => ({
  rateResponse: vi.fn().mockResolvedValue(5),
}));

vi.mock('../metrics.js', () => ({
  stepExecuted: vi.fn(),
  stepFailed: vi.fn(),
  usdcReleased: vi.fn(),
}));

describe('Resumable Executor & Exactly-Once Payment', () => {
  const mockAgent1: AgentRecord = {
    agent_id: 'agent-oracle',
    name: 'Stellar Oracle',
    description: 'Oracle service',
    capabilities: ['crypto_price'],
    pricing: { model: 'x402', price_per_call: 0.05, currency: 'USDC' },
    endpoint: 'http://localhost:4001',
    stellar_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    health_check: 'http://localhost:4001/health',
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    status: 'active',
    reputation: {
      score: 95,
      total_jobs: 10,
      successful_jobs: 10,
      failed_jobs: 0,
      avg_quality: 5,
      avg_latency_ms: 50,
      last_updated: new Date().toISOString(),
    },
  };

  const mockAgent2: AgentRecord = {
    agent_id: 'agent-analysis',
    name: 'Analysis Agent',
    description: 'Data analysis',
    capabilities: ['data_analysis'],
    pricing: { model: 'x402', price_per_call: 0.1, currency: 'USDC' },
    endpoint: 'http://localhost:4002',
    stellar_address: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    health_check: 'http://localhost:4002/health',
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    status: 'active',
    reputation: {
      score: 90,
      total_jobs: 10,
      successful_jobs: 10,
      failed_jobs: 0,
      avg_quality: 4.8,
      avg_latency_ms: 100,
      last_updated: new Date().toISOString(),
    },
  };

  const testPlan: ExecutionPlan = {
    total_estimated_cost: 0.15,
    reasoning: 'Fetch price then analyze',
    steps: [
      {
        step_id: 1,
        agent_id: 'agent-oracle',
        agent_name: 'Stellar Oracle',
        action: 'get_xlm_price',
        depends_on: null,
        estimated_cost: 0.05,
        payment_method: 'x402',
      },
      {
        step_id: 2,
        agent_id: 'agent-analysis',
        agent_name: 'Analysis Agent',
        action: 'analyze_trend',
        depends_on: 1,
        estimated_cost: 0.1,
        payment_method: 'x402',
      },
    ],
  };

  beforeEach(() => {
    taskExecutionStore.clearTaskExecutions();
    vi.clearAllMocks();

    // Mock fetch for health checks and feedback
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    }) as any;
  });

  afterEach(() => {
    taskExecutionStore.clearTaskExecutions();
  });

  it('1. Step State Machine: tracks full lifecycle transitions for fresh execution', async () => {
    vi.mocked(x402Client.makeX402Payment).mockImplementation(async (_endpoint, action) => {
      if (action === 'get_xlm_price') {
        return { output: 'XLM is $0.25', tx_hash: 'tx-hash-step-1' };
      }
      return { output: 'Trend is bullish', tx_hash: 'tx-hash-step-2' };
    });

    const executor = new PlanExecutor([mockAgent1, mockAgent2]);
    const taskId = 'task-state-machine-1';

    const result = await executor.execute(testPlan, 'Analyze XLM', 'http://localhost:4000', taskId);

    expect(result.status).toBe('complete');
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[1].success).toBe(true);

    const stored = taskExecutionStore.getTaskExecution(taskId);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('completed');
    expect(stored!.step_states[1].status).toBe('released');
    expect(stored!.step_states[1].output).toBe('XLM is $0.25');
    expect(stored!.step_states[1].tx_hash).toBe('tx-hash-step-1');
    expect(stored!.step_states[2].status).toBe('released');
    expect(stored!.step_states[2].output).toBe('Trend is bullish');
  });

  it('2. Crash before Step 2: resumes from Step 1 output without re-executing Step 1', async () => {
    const taskId = 'task-crash-step-2';

    // Seed state where step 1 was already released before crash
    const state = taskExecutionStore.initTaskExecution(
      taskId,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );

    taskExecutionStore.updateStepState(taskId, 1, {
      status: 'released',
      output: 'XLM is $0.25',
      tx_hash: 'tx-hash-step-1-settled',
      quality_rating: 5,
    });

    const x402Spy = vi
      .mocked(x402Client.makeX402Payment)
      .mockResolvedValueOnce({ output: 'Analysis complete', tx_hash: 'tx-hash-step-2' });

    const executor = new PlanExecutor([mockAgent1, mockAgent2]);
    const result = await executor.execute(testPlan, 'Analyze XLM', 'http://localhost:4000', taskId);

    expect(result.status).toBe('complete');
    // Step 1 agent call was NOT invoked again
    expect(x402Spy).toHaveBeenCalledTimes(1);
    expect(x402Spy).toHaveBeenCalledWith(
      'http://localhost:4002',
      'analyze_trend',
      'XLM is $0.25',
      expect.anything(),
    );

    // Verify stored final state
    const stored = taskExecutionStore.getTaskExecution(taskId);
    expect(stored!.status).toBe('completed');
    expect(stored!.step_states[1].tx_hash).toBe('tx-hash-step-1-settled');
    expect(stored!.step_states[2].status).toBe('released');
  });

  it('3. Crash after agent output delivered but before release: re-uses stored output and does not call agent again', async () => {
    const taskId = 'task-crash-delivered';

    taskExecutionStore.initTaskExecution(
      taskId,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );

    // Step 1 crashed in 'delivered' state with output already saved
    taskExecutionStore.updateStepState(taskId, 1, {
      status: 'delivered',
      output: 'Saved XLM Price: $0.26',
      tx_hash: 'agent-tx-123',
    });

    const x402Spy = vi
      .mocked(x402Client.makeX402Payment)
      .mockResolvedValueOnce({ output: 'Analysis done', tx_hash: 'tx-hash-step-2' });

    const executor = new PlanExecutor([mockAgent1, mockAgent2]);
    const result = await executor.execute(testPlan, 'Analyze XLM', 'http://localhost:4000', taskId);

    expect(result.status).toBe('complete');
    // Step 1 agent was not called again because output was already delivered
    expect(x402Spy).toHaveBeenCalledTimes(1);
    expect(result.steps[0].output).toBe('Saved XLM Price: $0.26');
  });

  it('4. Crash during releasing (ambiguous on-chain state): reconciles and settles without double payment', async () => {
    const taskId = 'task-crash-releasing';

    taskExecutionStore.initTaskExecution(
      taskId,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );

    // Step 1 was in 'releasing' state with output already obtained
    taskExecutionStore.updateStepState(taskId, 1, {
      status: 'releasing',
      output: 'Delivered Data',
      tx_hash: 'tx-agent-1',
    });

    vi.mocked(x402Client.makeX402Payment).mockResolvedValueOnce({
      output: 'Step 2 Output',
      tx_hash: 'tx-agent-2',
    });

    const executor = new PlanExecutor([mockAgent1, mockAgent2]);
    const result = await executor.execute(testPlan, 'Analyze XLM', 'http://localhost:4000', taskId);

    expect(result.status).toBe('complete');
    const stored = taskExecutionStore.getTaskExecution(taskId);
    expect(stored!.step_states[1].status).toBe('released');
    expect(stored!.step_states[2].status).toBe('released');
  });

  it('5. Double / Multiple recovery runs are completely idempotent', async () => {
    const taskId = 'task-idempotent-recovery';

    taskExecutionStore.initTaskExecution(
      taskId,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );

    vi.mocked(x402Client.makeX402Payment).mockResolvedValue({
      output: 'Result',
      tx_hash: 'tx-agent',
    });

    // Run 1: completes task
    const rec1 = await recoverUnfinishedTasks([mockAgent1, mockAgent2], 'http://localhost:4000');
    expect(rec1.recovered).toBe(1);
    expect(rec1.results[0].status).toBe('complete');

    // Run 2: finds 0 unfinished tasks (all settled)
    const rec2 = await recoverUnfinishedTasks([mockAgent1, mockAgent2], 'http://localhost:4000');
    expect(rec2.recovered).toBe(0);
    expect(rec2.results.length).toBe(0);
  });

  it('6. On-chain cancellation while offline: halts remaining steps and marks task cancelled', async () => {
    const taskId = 'task-cancelled-onchain';

    taskExecutionStore.initTaskExecution(
      taskId,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
      null,
      101, // vault_task_id = 101
    );

    // Mock on-chain task as completed (user cancelled on-chain while orchestrator was down)
    vi.spyOn(agentVaultClient, 'getTask').mockResolvedValueOnce({
      user: 'GUSER...',
      orchestrator: 'GORCH...',
      asset: 'USDC...',
      plan_cost: 0.15,
      spent: 0,
      completed: true, // Cancelled/finalized on chain!
      disputed: false,
      created_at: 12345678,
    });

    const x402Spy = vi.mocked(x402Client.makeX402Payment);

    const executor = new PlanExecutor([mockAgent1, mockAgent2], null, 101n);
    const result = await executor.execute(testPlan, 'Analyze XLM', 'http://localhost:4000', taskId);

    expect(result.status).toBe('failed');
    // No agent calls were executed!
    expect(x402Spy).not.toHaveBeenCalled();

    const stored = taskExecutionStore.getTaskExecution(taskId);
    expect(stored!.status).toBe('cancelled');
  });

  it('7. Concurrent recovery of multiple unfinished tasks', async () => {
    const task1 = 'task-concurrent-1';
    const task2 = 'task-concurrent-2';

    taskExecutionStore.initTaskExecution(
      task1,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );
    taskExecutionStore.initTaskExecution(
      task2,
      'Analyze XLM',
      testPlan.total_estimated_cost,
      testPlan,
    );

    vi.mocked(x402Client.makeX402Payment).mockResolvedValue({
      output: 'Concurrent output',
      tx_hash: 'tx-concurrent',
    });

    const recovery = await recoverUnfinishedTasks([mockAgent1, mockAgent2], 'http://localhost:4000');
    expect(recovery.recovered).toBe(2);
    expect(recovery.results.length).toBe(2);
    expect(recovery.results[0].status).toBe('complete');
    expect(recovery.results[1].status).toBe('complete');
  });
});
