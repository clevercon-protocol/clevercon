/**
 * Structured error model mapped from the CleverVault contract's `VaultError`.
 *
 * Every contract error discriminant has a named variant. Unknown/newer
 * error codes are preserved (never swallowed) — callers can branch on
 * `error.known` to decide how to handle them.
 *
 * The `vault-errors.test.ts` divergence test reads `contracts/agent-vault/src/lib.rs`
 * and fails this package's test suite if they drift apart.
 */

// ── Error code enum (mirrors lib.rs VaultError) ──────────────────────────────

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

// ── Extraction utilities ─────────────────────────────────────────────────────

const SIMULATION_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

function contractCodeFromScVal(val: import('@stellar/stellar-sdk').xdr.ScVal): number | null {
  if (val.switch().name !== 'scvError') return null;
  const scError = val.error();
  if (scError.switch().name !== 'sceContract') return null;
  return scError.contractCode();
}

function contractCodeFromDiagnosticEvents(
  events: readonly import('@stellar/stellar-sdk').xdr.DiagnosticEvent[] | undefined,
): number | null {
  if (!events) return null;
  for (const diag of events) {
    try {
      const body = diag.event().body();
      if (body.switch() !== 0) continue;
      const code = contractCodeFromScVal(body.v0().data());
      if (code !== null) return code;
    } catch {
      // Unexpected/malformed event shape — skip
    }
  }
  return null;
}

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
  diagnosticEvents?: readonly import('@stellar/stellar-sdk').xdr.DiagnosticEvent[];
}): number | null {
  return (
    contractCodeFromDiagnosticEvents(source.diagnosticEvents) ??
    contractCodeFromMessage(source.message)
  );
}

// ── Error builders (for SDK internal use) ────────────────────────────────────

export function errorFromSimulation(sim: {
  error?: string;
  events?: readonly import('@stellar/stellar-sdk').xdr.DiagnosticEvent[];
}): Error {
  const code = extractContractErrorCode({ message: sim.error, diagnosticEvents: sim.events });
  return code !== null
    ? new VaultContractError(code, sim)
    : new Error(`Simulation failed: ${sim.error}`);
}

export function errorFromSendResponse(response: {
  diagnosticEvents?: readonly import('@stellar/stellar-sdk').xdr.DiagnosticEvent[];
  errorResult?: unknown;
}): Error {
  const code = extractContractErrorCode({ diagnosticEvents: response.diagnosticEvents });
  return code !== null
    ? new VaultContractError(code, response)
    : new Error(`Send failed: ${JSON.stringify(response.errorResult)}`);
}

export function errorFromFailedTransaction(
  hash: string,
  result: {
    diagnosticEventsXdr?: readonly import('@stellar/stellar-sdk').xdr.DiagnosticEvent[];
  },
): Error {
  const code = extractContractErrorCode({ diagnosticEvents: result.diagnosticEventsXdr });
  return code !== null
    ? new VaultContractError(code, result)
    : new Error(`Transaction failed: ${hash}`);
}
