// Marketplace acceptance-contract types for the SDK. These are a pure,
// dependency-free wire contract, mirrored here so the published SDK stays
// self-contained (it must not depend on @clevercon/common, which pulls server
// deps like ioredis). KEEP IN SYNC with packages/common/src/service-manifest.ts,
// the server-side copy. See .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5, 11.

export type Tier = 'T1' | 'T2' | 'T3';

export type VerificationMethod =
  | 'onchain'
  | 'witness'
  | 'content-hash'
  | 'signature'
  | 'attest'
  | 'manual';

export interface VerificationSpec {
  method: VerificationMethod;
  spec?: Record<string, unknown>;
}

export interface ArtifactRef {
  url: string;
  hash: string;
  contentType: string;
  size: number;
}

export type JsonSchema = Record<string, unknown>;

export type ServiceInteraction = 'sync' | 'async' | 'human' | 'metered';

export type PaymentModel = 'escrow' | 'x402' | 'mpp-session' | 'subscription';

export interface AttachmentSpec {
  required?: boolean;
  accept?: string[];
  maxSizeBytes?: number;
  maxCount?: number;
}

/** A usage requirement the buyer must satisfy before hiring (mirror of common). */
export type PrerequisiteKind = 'info' | 'apiKey' | 'install' | 'oauth';
export interface Prerequisite {
  kind: PrerequisiteKind;
  key: string;
  label: string;
  instructions: string;
  url?: string;
  secret?: boolean;
}

/** How a single function is billed (mirror of common). */
export type PricingKind = 'free' | 'per_call' | 'per_usage' | 'subscription';
export interface FunctionPricing {
  model: PricingKind;
  amount?: number;
  currency?: 'USDC';
  unit?: string;
  period?: 'day' | 'week' | 'month';
}

/**
 * One callable operation of a service, with its own io, usage requirements, and
 * pricing. `key` equals the dispatched `action` (mirror of common).
 */
export interface ServiceFunction {
  key: string;
  label: string;
  description?: string;
  input?: JsonSchema;
  output?: JsonSchema;
  requires?: string[];
  pricing: FunctionPricing;
  tier?: Tier;
  verification?: VerificationSpec;
  interaction?: ServiceInteraction;
}

/** Public contact and identity links (mirror of common). */
export interface ContactLinks {
  website?: string;
  docs?: string;
  support?: string;
  github?: string;
  x?: string;
  discord?: string;
}

export type ResultStatus = 'completed' | 'working' | 'input_required' | 'failed';

export interface InputRequest {
  requestId: string;
  prompt: string;
  schema?: JsonSchema;
}

export interface ServiceManifest {
  id: string;
  name: string;
  category: string;
  tier: Tier;
  description: string;
  capabilities: string[];
  pricing: { model: 'direct' | 'x402' | 'mpp'; pricePerCall: number; currency: 'USDC' };
  payout: string;
  io: { input: JsonSchema; output: JsonSchema };
  verification: VerificationSpec;
  dispute?: { windowSec: number };
  bond?: { amount: number; asset: 'USDC' };
  healthCheck?: string;
  slaMaxLatencyMs?: number;
  version: number;
  /** Interaction shape; absent means 'sync' (back-compat). */
  interaction?: ServiceInteraction;
  /** Payment model; absent means 'escrow'. */
  paymentModel?: PaymentModel;
  /** Input-attachment requirement, when the service needs files on input. */
  attachmentsIn?: AttachmentSpec;
  /** Requirement CATALOG: every usage requirement any function may need (by key). */
  prerequisites?: Prerequisite[];
  /** The callable functions, each with its own requirements and pricing. */
  functions?: ServiceFunction[];
  /** Public contact/identity links (website, docs, support, socials). */
  contactLinks?: ContactLinks;
  /** The service may ask the user a question mid-job (elicitation). */
  mayElicit?: boolean;
  /** The service streams a metered result (per-tick billing). */
  streaming?: boolean;
}

export interface JobRequestEnvelope {
  jobId: string;
  taskId: string;
  stepId: string;
  action: string;
  input: Record<string, unknown>;
  attachments?: ArtifactRef[];
  /** Buyer's satisfied usage-requirement values (API key/token, OAuth marker, info). */
  credentials?: Record<string, string>;
  replyFormat: 'json' | 'text' | 'reference';
  deadline: number;
  idempotencyKey: string;
  /** dispatch (default) starts a job; poll checks an async handle; answer resumes input_required. */
  kind?: 'dispatch' | 'poll' | 'answer';
  /** The provider's durable job handle, sent on a poll. */
  handle?: string;
  /** On an answer: which InputRequest this responds to, and the response payload. */
  requestId?: string;
  inputResponse?: Record<string, unknown>;
}

export interface JobResultEnvelope {
  ok: boolean;
  contentType: string;
  data?: unknown;
  artifact?: ArtifactRef;
  error?: string;
  issuedAt: number;
  signature?: string;
  /** Lifecycle status; absent means completed when ok, else failed. */
  status?: ResultStatus;
  /** For an async job: the durable handle the worker polls. */
  handle?: string;
  /** Optional progress for a working async job. */
  progress?: { pct?: number; message?: string };
  /** For input_required: the typed question to put to the user or agent. */
  inputRequest?: InputRequest;
}
