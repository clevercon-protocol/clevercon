/**
 * Browser-safe entry for the pp/2 client prover. Re-exports only the pure pieces
 * (witness build, snarkjs proof, Soroban codec, policy-bundle mapping) with NO
 * Node builtins, so a browser bundler (Vite) can include it cleanly. The dapp
 * imports from here and passes artifact URLs straight to {@link createBatchProof}
 * (snarkjs fetches them with range requests); it does not use the Node-only
 * `resolveArtifacts`.
 */
export * from './payments/batch-prover.js';
export * from './payments/policy-bundle.js';
export {
  payeeField,
  amountScalar,
  feScalar,
  proofToSoroban,
  extractBatchOutputs,
  type SorobanProof,
} from './payments/policy-codec.js';
export {
  DEFAULT_ARTIFACT_BASE_URL,
  DEFAULT_POSEIDON_ARTIFACTS,
} from './payments/artifacts-base.js';
export { buildAllowlist, windowsRoot } from './payments/allowlist.js';
export type { AllowlistEntry, Allowlist } from './payments/allowlist.js';
export { makePoseidon } from './payments/poseidon.js';
export type { Poseidon, PoseidonArtifacts } from './payments/poseidon.js';
export { buildPrivateDisbursement } from './payments/private-disburse.js';
export type {
  DisbursementLine,
  PrivateDisburseArtifacts,
  PrivateDisbursement,
} from './payments/private-disburse.js';
