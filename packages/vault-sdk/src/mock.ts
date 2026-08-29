/**
 * Dependency-free mock mode for local development and testing.
 *
 * Returns deterministic responses for every VaultClient method so tests
 * can run with zero RPC connectivity.
 */

import type {
  UserAccount,
  UserConfig,
  TaskInfo,
  TaskStatus,
  FeeConfig,
} from './types.js';
import { VaultContractError } from './errors.js';

/** Default deterministic mock asset address. */
const MOCK_ASSET = 'DCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

/** Internal state for the mock. */
interface MockState {
  userAccounts: Map<string, UserAccount>;
  tasks: Map<bigint, TaskInfo>;
  taskCounter: bigint;
  paused: boolean;
  supportedAssets: string[];
  fee: FeeConfig;
  disputeResolver: string | null;
}

function createDefaultState(): MockState {
  return {
    userAccounts: new Map(),
    tasks: new Map(),
    taskCounter: 0n,
    paused: false,
    supportedAssets: [MOCK_ASSET],
    fee: { bps: 0, recipient: null },
    disputeResolver: null,
  };
}

/**
 * Create a mock VaultClient-like object with deterministic responses.
 * Every method that normally hits RPC returns immediately with canned data.
 *
 * The returned object implements the same public API surface as VaultClient
 * but without any network dependencies.
 */
export function createMockVaultClient(overrides?: Partial<MockState>) {
  const state: MockState = { ...createDefaultState(), ...overrides };

  return {
    get mock(): boolean {
      return true;
    },
    get active(): boolean {
      return true;
    },

    // ── Views ──────────────────────────────────────────────────────────────
    async getBalance(userAddress: string): Promise<bigint> {
      const acct = state.userAccounts.get(userAddress);
      return acct?.balance ?? 0n;
    },
    async getAvailable(userAddress: string): Promise<bigint> {
      const acct = state.userAccounts.get(userAddress);
      if (!acct) return 0n;
      return acct.balance - acct.locked;
    },
    async getAccount(userAddress: string): Promise<UserAccount | null> {
      return state.userAccounts.get(userAddress) ?? null;
    },
    async getUserConfig(userAddress: string): Promise<UserConfig | null> {
      const acct = state.userAccounts.get(userAddress);
      if (!acct) return null;
      return {
        orchestrator: acct.orchestrator,
        orchestrator_name: acct.orchestrator_name,
        active_tasks_count: acct.active_tasks_count,
        created_at: acct.created_at,
      };
    },
    async getTask(taskId: bigint): Promise<TaskInfo | null> {
      return state.tasks.get(taskId) ?? null;
    },
    async getTaskStatus(taskId: bigint): Promise<TaskStatus | null> {
      const task = state.tasks.get(taskId);
      if (!task) return null;
      if (task.completed) return 'Completed';
      if (task.disputed) return 'Disputed';
      return 'Active';
    },
    async getUserTasks(userAddress: string): Promise<bigint[]> {
      const tasks: bigint[] = [];
      for (const [id, task] of state.tasks) {
        if (task.user === userAddress) tasks.push(id);
      }
      return tasks;
    },
    async getOrchestratorOwner(orchestratorAddress: string): Promise<string | null> {
      for (const [userAddr, acct] of state.userAccounts.entries()) {
        if (acct.orchestrator === orchestratorAddress) return userAddr;
      }
      return null;
    },
    async isSupportedAsset(assetAddress: string): Promise<boolean> {
      return state.supportedAssets.includes(assetAddress);
    },
    async getSupportedAssets(): Promise<string[]> {
      return [...state.supportedAssets];
    },
    async taskCount(): Promise<bigint> {
      return state.taskCounter;
    },
    async version(): Promise<number> {
      return 5;
    },
    async isPaused(): Promise<boolean> {
      return state.paused;
    },
    async tokenBalance(assetAddress: string): Promise<bigint> {
      // Sum all user balances for this asset
      let total = 0n;
      for (const acct of state.userAccounts.values()) {
        total += acct.balance;
      }
      return total;
    },
    async getDisputeResolver(): Promise<string | null> {
      return state.disputeResolver;
    },
    async getStaleThreshold(): Promise<number> {
      return 1800;
    },
    async getMaxActiveTasks(): Promise<number> {
      return 50;
    },
    async getFee(): Promise<FeeConfig> {
      return { ...state.fee };
    },
    async getAccruedFees(assetAddress: string): Promise<bigint> {
      return 0n;
    },

    // ── Mutations (mock implementations that update state) ──────────────────

    /** Simulate deposit — updates mock state. */
    async mockDeposit(userAddress: string, amountUsdc: number): Promise<void> {
      const stroops = BigInt(Math.round(amountUsdc * 10_000_000));
      let acct = state.userAccounts.get(userAddress);
      if (!acct) {
        acct = {
          balance: 0n, locked: 0n, total_deposited: 0n, total_spent: 0n,
          active_tasks_count: 0, orchestrator: null, orchestrator_name: '', created_at: BigInt(Date.now()),
        };
        state.userAccounts.set(userAddress, acct);
      }
      acct.balance += stroops;
      acct.total_deposited += stroops;
    },

    /** Simulate create_task — updates mock state, returns mock task_id. */
    async mockCreateTask(
      orchestratorAddress: string,
      planCostUsdc: number,
      assetAddress?: string,
    ): Promise<bigint> {
      const owner = await this.getOrchestratorOwner(orchestratorAddress);
      if (!owner) throw new VaultContractError(14, { mock: true }); // OrchestratorNotRegistered

      const stroops = BigInt(Math.round(planCostUsdc * 10_000_000));
      const asset = assetAddress ?? MOCK_ASSET;
      const acct = state.userAccounts.get(owner);
      if (!acct) throw new Error('User not found in mock state');
      if (acct.balance - acct.locked < stroops) {
        throw new VaultContractError(6, { mock: true }); // InsufficientAvailable
      }

      acct.locked += stroops;
      acct.active_tasks_count += 1;

      state.taskCounter += 1n;
      const task: TaskInfo = {
        user: owner,
        orchestrator: orchestratorAddress,
        asset,
        plan_cost: stroops,
        spent: 0n,
        completed: false,
        disputed: false,
        created_at: BigInt(Date.now()),
      };
      state.tasks.set(state.taskCounter, task);
      return state.taskCounter;
    },

    /** Register an orchestrator in mock state. */
    async mockRegisterOrchestrator(
      userAddress: string,
      orchestratorAddress: string,
      name: string,
    ): Promise<void> {
      let acct = state.userAccounts.get(userAddress);
      if (!acct) {
        acct = {
          balance: 0n, locked: 0n, total_deposited: 0n, total_spent: 0n,
          active_tasks_count: 0, orchestrator: null, orchestrator_name: '', created_at: BigInt(Date.now()),
        };
        state.userAccounts.set(userAddress, acct);
      }
      if (acct.orchestrator) {
        throw new VaultContractError(15, { mock: true }); // OrchestratorAlreadyRegistered
      }
      acct.orchestrator = orchestratorAddress;
      acct.orchestrator_name = name;
    },

    /** Complete a task — marks it done, unlocks budget minus spent. */
    async mockCompleteTask(orchestratorAddress: string, taskId: bigint): Promise<void> {
      const task = state.tasks.get(taskId);
      if (!task) throw new VaultContractError(8, { mock: true }); // TaskNotFound
      if (task.completed) throw new VaultContractError(9, { mock: true }); // TaskAlreadyCompleted
      if (task.orchestrator !== orchestratorAddress) throw new VaultContractError(17, { mock: true }); // NotYourOrchestrator

      const owner = task.user;
      const acct = state.userAccounts.get(owner);
      if (acct) {
        acct.locked -= task.plan_cost;
        acct.balance -= task.spent;
        acct.total_spent += task.spent;
        acct.active_tasks_count -= 1;
      }
      task.completed = true;
    },

    /** Cancel a task — unlocks full budget. */
    async mockCancelTask(userAddress: string, taskId: bigint): Promise<void> {
      const task = state.tasks.get(taskId);
      if (!task) throw new VaultContractError(8, { mock: true }); // TaskNotFound
      if (task.completed) throw new VaultContractError(9, { mock: true }); // TaskAlreadyCompleted
      if (task.user !== userAddress) throw new VaultContractError(16, { mock: true }); // NotYourTask
      if (task.disputed) throw new VaultContractError(19, { mock: true }); // TaskDisputed

      const acct = state.userAccounts.get(userAddress);
      if (acct) {
        acct.locked -= task.plan_cost;
        acct.balance -= task.spent;
        acct.total_spent += task.spent;
        acct.active_tasks_count -= 1;
      }
      task.completed = true;
    },

    /** Access internal state for assertions in tests. */
    _state: state,
  };
}
