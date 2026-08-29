import { describe, it, expect } from 'vitest';
import { VaultClient } from './client.js';
import { createMockVaultClient } from './mock.js';
import { VaultErrorCode, VaultContractError } from './errors.js';

describe('VaultClient.usdcToStroops / stroopsToUsdc', () => {
  it('converts 1 USDC to 10_000_000 stroops', () => {
    expect(VaultClient.usdcToStroops(1)).toBe(10_000_000n);
  });

  it('converts 0.5 USDC to 5_000_000 stroops', () => {
    expect(VaultClient.usdcToStroops(0.5)).toBe(5_000_000n);
  });

  it('converts 10_000_000 stroops to 1 USDC', () => {
    expect(VaultClient.stroopsToUsdc(10_000_000n)).toBe(1);
  });

  it('round-trips through USDC ↔ stroops', () => {
    const usdc = 42.1234567;
    const stroops = VaultClient.usdcToStroops(usdc);
    expect(VaultClient.stroopsToUsdc(stroops)).toBeCloseTo(usdc, 1);
  });
});

describe('createMockVaultClient', () => {
  it('is in mock mode', () => {
    const mock = createMockVaultClient();
    expect(mock.mock).toBe(true);
    expect(mock.active).toBe(true);
  });

  it('returns zeroed account for unknown user', async () => {
    const mock = createMockVaultClient();
    const acct = await mock.getAccount('GUNKNOWN');
    expect(acct).toBeNull();
  });

  it('returns version 5', async () => {
    const mock = createMockVaultClient();
    expect(await mock.version()).toBe(5);
  });

  it('returns 1800 for stale threshold', async () => {
    const mock = createMockVaultClient();
    expect(await mock.getStaleThreshold()).toBe(1800);
  });

  it('returns 50 for max active tasks', async () => {
    const mock = createMockVaultClient();
    expect(await mock.getMaxActiveTasks()).toBe(50);
  });

  it('returns zero fee config by default', async () => {
    const mock = createMockVaultClient();
    const fee = await mock.getFee();
    expect(fee.bps).toBe(0);
    expect(fee.recipient).toBeNull();
  });

  it('mockDeposit increases user balance', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const before = await mock.getBalance(user);
    await mock.mockDeposit(user, 100);
    const after = await mock.getBalance(user);
    expect(after - before).toBe(1_000_000_000n);
  });

  it('mockRegisterOrchestrator records the mapping', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    const config = await mock.getUserConfig(user);
    expect(config?.orchestrator).toBe(orch);
    expect(config?.orchestrator_name).toBe('TestOrch');
  });

  it('mockRegisterOrchestrator throws OrchestratorAlreadyRegistered', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await expect(mock.mockRegisterOrchestrator(user, orch, 'TestOrch')).rejects.toThrow(
      VaultContractError,
    );
  });

  it('mockCreateTask returns sequential task IDs', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);

    const id1 = await mock.mockCreateTask(orch, 10);
    const id2 = await mock.mockCreateTask(orch, 10);
    expect(id2).toBe(id1 + 1n);
  });

  it('mockCreateTask throws OrchestratorNotRegistered for unknown orchestrator', async () => {
    const mock = createMockVaultClient();
    await expect(mock.mockCreateTask('GUNKNOWN', 10)).rejects.toThrow(VaultContractError);
  });

  it('mockCreateTask throws InsufficientAvailable when balance too low', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    // Don't deposit — balance is 0
    await expect(mock.mockCreateTask(orch, 10)).rejects.toThrow(VaultContractError);
  });

  it('getTask returns task info after mockCreateTask', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);

    const taskId = await mock.mockCreateTask(orch, 10);
    const task = await mock.getTask(taskId);
    expect(task).not.toBeNull();
    expect(task?.user).toBe(user);
    expect(task?.orchestrator).toBe(orch);
    expect(task?.plan_cost).toBe(100_000_000n);
    expect(task?.completed).toBe(false);
    expect(task?.disputed).toBe(false);
  });

  it('getTaskStatus returns Active for a new task', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);

    const taskId = await mock.mockCreateTask(orch, 10);
    const status = await mock.getTaskStatus(taskId);
    expect(status).toBe('Active');
  });

  it('taskCount increments after mockCreateTask', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);

    expect(await mock.taskCount()).toBe(0n);
    await mock.mockCreateTask(orch, 10);
    expect(await mock.taskCount()).toBe(1n);
    await mock.mockCreateTask(orch, 5);
    expect(await mock.taskCount()).toBe(2n);
  });

  it('mockCompleteTask marks task done and unlocks budget', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);
    const taskId = await mock.mockCreateTask(orch, 10);

    const taskBefore = await mock.getTask(taskId);
    expect(taskBefore?.completed).toBe(false);

    await mock.mockCompleteTask(orch, taskId);

    const taskAfter = await mock.getTask(taskId);
    expect(taskAfter?.completed).toBe(true);

    // Budget was locked at 10 USDC = 100_000_000 stroops
    // With 0 spent, balance should go from 100 USDC to 100 USDC (locked released, no spend deducted)
    const acct = await mock.getAccount(user);
    expect(acct?.locked).toBe(0n);
  });

  it('mockCompleteTask throws TaskNotFound for unknown task', async () => {
    const mock = createMockVaultClient();
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await expect(mock.mockCompleteTask(orch, 999n)).rejects.toThrow(VaultContractError);
  });

  it('mockCompleteTask throws TaskAlreadyCompleted for completed task', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);
    const taskId = await mock.mockCreateTask(orch, 10);
    await mock.mockCompleteTask(orch, taskId);
    await expect(mock.mockCompleteTask(orch, taskId)).rejects.toThrow(VaultContractError);
  });

  it('mockCancelTask marks task done and unlocks budget', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);
    const taskId = await mock.mockCreateTask(orch, 10);

    await mock.mockCancelTask(user, taskId);
    const task = await mock.getTask(taskId);
    expect(task?.completed).toBe(true);
  });

  it('mockCancelTask throws NotYourTask for wrong user', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);
    const taskId = await mock.mockCreateTask(orch, 10);

    await expect(mock.mockCancelTask('GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', taskId)).rejects.toThrow(VaultContractError);
  });

  it('getUserTasks returns task IDs for a user', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);

    expect(await mock.getUserTasks(user)).toEqual([]);
    const id1 = await mock.mockCreateTask(orch, 10);
    const id2 = await mock.mockCreateTask(orch, 5);
    const tasks = await mock.getUserTasks(user);
    expect(tasks).toContain(id1);
    expect(tasks).toContain(id2);
  });

  it('isSupportedAsset returns true for MOCK_ASSET', async () => {
    const mock = createMockVaultClient();
    expect(await mock.isSupportedAsset('DCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC')).toBe(true);
    expect(await mock.isSupportedAsset('GUNKNOWN')).toBe(false);
  });

  it('isPaused returns false by default', async () => {
    const mock = createMockVaultClient();
    expect(await mock.isPaused()).toBe(false);
  });

  it('getAvailable returns balance minus locked', async () => {
    const mock = createMockVaultClient();
    const user = 'GAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const orch = 'GCCCCCCCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    await mock.mockRegisterOrchestrator(user, orch, 'TestOrch');
    await mock.mockDeposit(user, 100);
    const available1 = await mock.getAvailable(user);
    expect(available1).toBe(1_000_000_000n);

    await mock.mockCreateTask(orch, 10);
    const available2 = await mock.getAvailable(user);
    expect(available2).toBe(900_000_000n);
  });
});
