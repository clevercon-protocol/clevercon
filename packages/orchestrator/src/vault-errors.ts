/**
 * Typed mirror of the CleverVault contract's `VaultError` enum
 * (contracts/agent-vault/src/lib.rs), plus the plumbing to recover a
 * numeric contract error code from a failed Soroban invocation and turn it
 * into a typed, branchable error.
 *
 * `VaultErrorCode` is kept in sync with the Rust source by
 * `vault-errors.test.ts`, which parses `lib.rs` directly and fails if the
 * two diverge — see docs/development.md.
 */

import type { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { xdr } from '@stellar/stellar-sdk';

// ── VaultError mirror ────────────────────────────────────────────────────────

export enum VaultErrorCode {
  AlreadyInitialized = 1,
  Unauthorized = 2,
  ContractPaused = 3,
  AssetNotSupported = 4,
  InsufficientBalance = 5,
  InsufficientAvailable = 6,
  ActiveTaskExists = 7,
  TaskNotFound = 8,
  TaskAlreadyCompleted = 9,
  TaskNotStale = 10,
  InvalidAmount = 11,
  ExceedsPlanCost = 12,
  AssetMismatch = 13,
  OrchestratorNotRegistered = 14,
  OrchestratorAlreadyRegistered = 15,
  NotYourTask = 16,
  NotYourOrchestrator = 17,
  TooManyActiveTasks = 18,
  TaskDisputed = 19,
  NotDisputeResolver = 20,
  DisputeSplitMismatch = 21,
  DisputeResolverNotSet = 22,
  TaskNotDisputed = 23,
  ReleaseConflict = 24,
  TooManyStepReleases = 25,
  FeeBpsExceedsCap = 26,
  NoFeesAccrued = 27,
  InvalidCommitment = 28,
  PolicyVerifierNotSet = 29,
  PolicyProofRequired = 30,
  NoPolicyCommitment = 31,
  PolicyProofRejected = 32,
  NullifierAlreadyUsed = 33,
}

/**
 * Thrown when a CleverVault contract invocation reverts with a `VaultError`.
 *
 * `code` and `raw` are always present. `codeName`/`known` reflect whether
 * `code` matches a variant this client knows about — an unmapped code (e.g.
 * a contract deployed with newer error variants than this client's mirror)
 * still produces a `VaultContractError`, never a swallowed/opaque failure.
 */
export class VaultContractError extends Error {
  readonly code: number;
  readonly codeName: string | undefined;
  readonly known: boolean;
  /** The original simulation/send/transaction response this was extracted from. */
  readonly raw: unknown;

  constructor(code: number, raw: unknown) {
    const codeName = VaultErrorCode[code] as string | undefined;
    super(codeName ? `VaultError.${codeName} (code ${code})` : `VaultError: unknown code ${code}`);
    this.name = 'VaultContractError';
    this.code = code;
    this.codeName = codeName;
    this.known = codeName !== undefined;
    this.raw = raw;
  }
}

// ── Extracting the numeric code from a failed invocation ────────────────────

const SIMULATION_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

function contractCodeFromScVal(val: xdr.ScVal): number | null {
  if (val.switch().name !== 'scvError') return null;
  const scError = val.error();
  if (scError.switch().name !== 'sceContract') return null;
  return scError.contractCode();
}

/**
 * Diagnostic events carry the structured `Error(Contract, #N)` value the
 * host raised. This is the reliable path for the submit/poll flow, where —
 * unlike simulation — there is no human-readable error string.
 */
function contractCodeFromDiagnosticEvents(
  events: readonly xdr.DiagnosticEvent[] | undefined,
): number | null {
  if (!events) return null;
  for (const diag of events) {
    try {
      const body = diag.event().body();
      if (body.switch() !== 0) continue; // only ContractEventBody v0 exists today
      const code = contractCodeFromScVal(body.v0().data());
      if (code !== null) return code;
    } catch {
      // Unexpected/malformed event shape — skip it rather than fail extraction.
    }
  }
  return null;
}

/**
 * Simulation failures carry a human-readable `HostError` string (no
 * diagnostic events are attached to the error response itself); the
 * contract error, if any, appears as `Error(Contract, #N)` in that text.
 * A non-contract failure (network error, auth failure, malformed
 * transaction, ...) never matches this pattern, so it can't be
 * misclassified as a VaultError.
 */
function contractCodeFromMessage(message: string | undefined): number | null {
  if (!message) return null;
  const match = SIMULATION_ERROR_PATTERN.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Extracts the numeric VaultError discriminant from a failed Soroban
 * invocation, or `null` if this wasn't a contract revert at all.
 */
export function extractContractErrorCode(source: {
  message?: string;
  diagnosticEvents?: readonly xdr.DiagnosticEvent[];
}): number | null {
  return (
    contractCodeFromDiagnosticEvents(source.diagnosticEvents) ??
    contractCodeFromMessage(source.message)
  );
}

// ── Building the right Error for each failure shape ──────────────────────────

export function errorFromSimulation(sim: SorobanRpc.Api.SimulateTransactionErrorResponse): Error {
  const code = extractContractErrorCode({ message: sim.error, diagnosticEvents: sim.events });
  return code !== null
    ? new VaultContractError(code, sim)
    : new Error(`Simulation failed: ${sim.error}`);
}

export function errorFromSendResponse(response: SorobanRpc.Api.SendTransactionResponse): Error {
  const code = extractContractErrorCode({ diagnosticEvents: response.diagnosticEvents });
  return code !== null
    ? new VaultContractError(code, response)
    : new Error(`Send failed: ${JSON.stringify(response.errorResult)}`);
}

export function errorFromFailedTransaction(
  hash: string,
  result: SorobanRpc.Api.GetFailedTransactionResponse,
): Error {
  const code = extractContractErrorCode({ diagnosticEvents: result.diagnosticEventsXdr });
  return code !== null
    ? new VaultContractError(code, result)
    : new Error(`Transaction failed: ${hash}`);
}
