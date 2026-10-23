export { createAgent } from './agent.js';
export { withX402, createPayingFetch } from './payments/x402.js';
export { withMpp } from './payments/mpp.js';
export {
  buildBatchWitness,
  proveBatch,
  createBatchProof,
  policyCommitment,
  buildBatchReleaseRequest,
  submitBatchRelease,
  BATCH_RELEASE_PATH,
  BATCH_N,
  ALLOWLIST_DEPTH,
  CATEGORY_COUNT,
  CALENDAR_WINDOWS,
} from './payments/batch-prover.js';
export type {
  PolicyWitness,
  BatchRelease,
  BatchContext,
  BatchProof,
  BatchReleaseRequest,
  BatchReleaseMeta,
  AllowlistMembership,
} from './payments/batch-prover.js';
export {
  payeeField,
  amountScalar,
  feScalar,
  proofToSoroban,
  extractBatchOutputs,
  type SorobanProof,
} from './payments/policy-codec.js';
export { newSalt, policyWitnessFromBundle, buildPolicyWitness } from './payments/policy-bundle.js';
export type { PolicyBundle, PolicyBundleRules } from './payments/policy-bundle.js';
export { buildPrivateDisbursement, commitmentForBundle } from './payments/private-disburse.js';
export type {
  DisbursementLine,
  PrivateDisburseArtifacts,
  PrivateDisbursement,
  AccumulatorState,
} from './payments/private-disburse.js';
export { resolveArtifacts, DEFAULT_ARTIFACT_BASE_URL } from './payments/artifacts.js';
export type { ArtifactSource } from './payments/artifacts.js';
export { makePoseidon } from './payments/poseidon.js';
export type { Poseidon, PoseidonArtifacts } from './payments/poseidon.js';
export { DEFAULT_POSEIDON_ARTIFACTS } from './payments/artifacts-base.js';
export { buildAllowlist, windowsRoot } from './payments/allowlist.js';
export type { AllowlistEntry, Allowlist } from './payments/allowlist.js';
export { createRegistryClient } from './registry.js';
export { AgentConfigError } from './config.js';
export { createProvider, MAX_OUTPUT_CHARS } from './provider.js';
export { createSpender, CleverConError } from './spender.js';
export { createAgentWallet } from './agent-wallet.js';
export {
  registerSession,
  createSessionSpender,
  revokeSession,
  getSessionScope,
  SessionError,
} from './sessions.js';
export type {
  SessionNetwork,
  RegisterSessionOptions,
  RegisteredSession,
  SessionScope,
  SessionSpender,
} from './sessions.js';
export type {
  SpenderOptions,
  CleverConClient,
  PaymentLine,
  SpendLimit,
  Budget,
  Spend,
  SavedLimit,
} from './spender.js';
export type { AgentWalletOptions, AgentWallet } from './agent-wallet.js';
export type {
  Provider,
  ProviderOptions,
  FulfillmentRequest,
  FulfillmentResult,
  FulfillmentHandler,
} from './provider.js';

export type {
  AgentConfig,
  AgentServer,
  AgentManifestConfig,
  AgentHandler,
  AgentTask,
  AgentContext,
  AgentResult,
  FeedbackOutcome,
  PaymentInfo,
  PaymentModel,
  RegistrationPayload,
  Logger,
  SdkDeps,
} from './types.js';
export type { WithX402Options, PayingFetchOptions } from './payments/x402.js';
export type { WithMppOptions } from './payments/mpp.js';
export type { RegistryClient, RegistryClientOptions } from './registry.js';
export type { ResolvedConfig } from './config.js';

// Marketplace acceptance contract + buyer-side verification (P0.3).
export {
  verifyResult,
  buildVerifier,
  validateSchema,
  resultSigningPayload,
  WITNESS_PREDICATES,
} from './verifier.js';
export type { VerifyResult, VerifyOptions, WitnessPredicate } from './verifier.js';
export type {
  Tier,
  VerificationMethod,
  VerificationSpec,
  ArtifactRef,
  JsonSchema,
  ServiceManifest,
  JobRequestEnvelope,
  JobResultEnvelope,
} from './marketplace.js';

// Marketplace discovery: find + inspect services in the public directory (P3.4).
export { createMarketplaceClient } from './discovery.js';
export type {
  MarketplaceClient,
  MarketplaceClientOptions,
  DiscoveredService,
  DiscoveryFilters,
  ServiceSort,
} from './discovery.js';
