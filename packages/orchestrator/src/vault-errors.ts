/**
 * Typed mirror of the CleverVault contract's `VaultError` enum.
 *
 * This module previously contained a standalone duplicate of the error
 * model. It now re-exports from `@clevercon/vault-sdk`, which is the
 * single source of truth maintained by the vault-errors divergence test.
 */

export {
  VaultErrorCode,
  VaultContractError,
  extractContractErrorCode,
  errorFromSimulation,
  errorFromSendResponse,
  errorFromFailedTransaction,
} from '@clevercon/vault-sdk';
