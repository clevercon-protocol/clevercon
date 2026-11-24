/**
 * Typed interfaces for CleverVault contract data structures.
 *
 * All amounts are in **stroops** (1 USDC = 10_000_000 stroops) unless
 * explicitly marked with a USDC suffix. The SDK always returns native
 * TypeScript types — callers never touch raw `ScVal`.
 */

// ── Contract data types ──────────────────────────────────────────────────────

/** Asset-specific balances and history for a user. */
export interface UserAssetAccount {
  balance: bigint;
  locked: bigint;
  total_deposited: bigint;
  total_spent: bigint;
  created_at: bigint;
}

/** Global, asset-agnostic user settings. */
export interface UserConfig {
  orchestrator: string | null;
  orchestrator_name: string;
  active_tasks_count: number;
  created_at: bigint;
}

/** Consolidated user account for external view queries. */
export interface UserAccount {
  balance: bigint;
  locked: bigint;
  total_deposited: bigint;
  total_spent: bigint;
  active_tasks_count: number;
  orchestrator: string | null;
  orchestrator_name: string;
  created_at: bigint;
}

/** Per-task state. */
export interface TaskInfo {
  user: string;
  orchestrator: string;
  asset: string;
  plan_cost: bigint;
  spent: bigint;
  completed: boolean;
  disputed: boolean;
  created_at: bigint;
}

/** Task lifecycle status. */
export type TaskStatus = 'Active' | 'Stale' | 'Disputed' | 'Completed';

/** Protocol fee configuration. */
export interface FeeConfig {
  bps: number;
  recipient: string | null;
}

// ── Event payload types ──────────────────────────────────────────────────────

export interface DepositEventPayload {
  user: string;
  asset: string;
  amount: bigint;
}

export interface WithdrawEventPayload {
  user: string;
  asset: string;
  amount: bigint;
}

export interface RegOrchEventPayload {
  user: string;
  orchestrator: string;
}

export interface UpdateOrchEventPayload {
  user: string;
  old_orchestrator: string;
  new_orchestrator: string;
}

export interface TaskNewEventPayload {
  user: string;
  orchestrator: string;
  task_id: bigint;
  asset: string;
  plan_cost: bigint;
}

export interface ReleaseEventPayload {
  user: string;
  orchestrator: string;
  task_id: bigint;
  asset: string;
  amount: bigint;
}

export interface TaskDoneEventPayload {
  user: string;
  task_id: bigint;
  asset: string;
  spent: bigint;
  refund: bigint;
}

export interface PauseEventPayload {
  admin: string;
}

export interface UnpauseEventPayload {
  admin: string;
}

export interface UpdateAdminEventPayload {
  old_admin: string;
  new_admin: string;
}

export interface DisputeRaisedEventPayload {
  user: string;
  task_id: bigint;
}

export interface DisputeResolvedEventPayload {
  resolver: string;
  task_id: bigint;
  refund_to_user: bigint;
  payout_to_orchestrator: bigint;
}

export interface FeeSetEventPayload {
  admin: string;
  bps: number;
  recipient: string | null;
}

export interface FeeAccruedEventPayload {
  asset: string;
  recipient: string;
  fee_amount: bigint;
  task_id: bigint;
}

export interface FeeClaimedEventPayload {
  asset: string;
  recipient: string;
  amount: bigint;
}

/** Union of all vault event types. */
export type VaultEvent =
  | { type: 'deposit'; payload: DepositEventPayload }
  | { type: 'withdraw'; payload: WithdrawEventPayload }
  | { type: 'reg_orch'; payload: RegOrchEventPayload }
  | { type: 'update_orch'; payload: UpdateOrchEventPayload }
  | { type: 'task_new'; payload: TaskNewEventPayload }
  | { type: 'release'; payload: ReleaseEventPayload }
  | { type: 'task_done'; payload: TaskDoneEventPayload }
  | { type: 'pause'; payload: PauseEventPayload }
  | { type: 'unpause'; payload: UnpauseEventPayload }
  | { type: 'update_admin'; payload: UpdateAdminEventPayload }
  | { type: 'dispute_raised'; payload: DisputeRaisedEventPayload }
  | { type: 'dispute_resolved'; payload: DisputeResolvedEventPayload }
  | { type: 'fee_set'; payload: FeeSetEventPayload }
  | { type: 'fee_accrued'; payload: FeeAccruedEventPayload }
  | { type: 'fee_claimed'; payload: FeeClaimedEventPayload };

// ── SDK config types ─────────────────────────────────────────────────────────

export type NetworkPassphrase = 'testnet' | 'mainnet';

export interface VaultSDKConfig {
  /** Contract ID on-chain. */
  contractId: string;
  /** RPC server URL. */
  rpcUrl?: string;
  /** Network passphrase — defaults to testnet. */
  network?: NetworkPassphrase;
  /** USDC Stellar Asset Contract address. */
  usdcSac?: string;
  /** Enable mock mode (no RPC calls, returns deterministic responses). */
  mock?: boolean;
}
