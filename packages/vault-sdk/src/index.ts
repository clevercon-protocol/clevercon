/**
 * @clevercon/vault-sdk — Reusable typed SDK for the CleverVault Soroban contract.
 *
 * Wraps every contract entrypoint with typed inputs, decoded native TypeScript
 * return values, and structured errors. Provides event subscription, network
 * config, and a dependency-free mock mode for local development.
 *
 * @example
 * ```ts
 * import { VaultClient } from '@clevercon/vault-sdk';
 *
 * const vault = new VaultClient({
 *   contractId: 'C...',
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   network: 'testnet',
 *   usdcSac: 'D...',
 * });
 *
 * const balance = await vault.getBalance(userAddress);
 * const taskInfo = await vault.getTask(taskId);
 * ```
 */

// Client
export { VaultClient } from './client.js';

// Errors
export {
  VaultErrorCode,
  VaultContractError,
  extractContractErrorCode,
  errorFromSimulation,
  errorFromSendResponse,
  errorFromFailedTransaction,
} from './errors.js';

// Types
export type {
  VaultSDKConfig,
  NetworkPassphrase,
  UserAssetAccount,
  UserConfig,
  UserAccount,
  TaskInfo,
  TaskStatus,
  FeeConfig,
  VaultEvent,
  DepositEventPayload,
  WithdrawEventPayload,
  RegOrchEventPayload,
  UpdateOrchEventPayload,
  TaskNewEventPayload,
  ReleaseEventPayload,
  TaskDoneEventPayload,
  PauseEventPayload,
  UnpauseEventPayload,
  UpdateAdminEventPayload,
  DisputeRaisedEventPayload,
  DisputeResolvedEventPayload,
  FeeSetEventPayload,
  FeeAccruedEventPayload,
  FeeClaimedEventPayload,
} from './types.js';

// Events
export { subscribeEvents, fetchEvents } from './events.js';
export type { EventSubscription, EventSubscriptionOptions } from './events.js';

// Mock
export { createMockVaultClient } from './mock.js';
