// The marketplace acceptance contract: the shared types that let a buyer, the
// worker, and a provider agree on HOW a service is called and HOW its delivery is
// judged. App-internal and camelCase, distinct from the snake_case `AgentManifest`
// in types.ts, which is the registry wire format kept for back-compat.
//
// Design: a service declares a verification `tier`, and the release path is matched
// to it. See .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5, 11.
//
// NOTE: the published SDK mirrors these in packages/agent-sdk/src/marketplace.ts
// (it must not depend on @clevercon/common). Keep the two in sync.

/**
 * Verification tier, determines how delivery is judged and when funds release.
 * - T1 Verifiable: trustless check (chain/witness/hash/signature) -> instant release.
 * - T2 Attestable: schema + optimistic release behind a dispute window (+ judge/arbiter).
 * - T3 Subjective: human/milestone approval.
 */
export type Tier = 'T1' | 'T2' | 'T3';

/**
 * How a T1 result is checked without trusting the provider, or how a T2/T3 result
 * is handled.
 * - onchain: re-derive the answer from Horizon/RPC and compare.
 * - witness: the output carries a witness the client re-checks cheaply.
 * - content-hash: output bytes must hash to a requested hash.
 * - signature: output signed by the provider's declared key (provenance/accountability).
 * - attest: T2, schema check + judge, no trustless proof.
 * - manual: T3, human/milestone approval.
 */
export type VerificationMethod =
  | 'onchain'
  | 'witness'
  | 'content-hash'
  | 'signature'
  | 'attest'
  | 'manual';

export interface VerificationSpec {
  method: VerificationMethod;
  /** Method-specific parameters (e.g. the re-derivation query, the signer key). */
  spec?: Record<string, unknown>;
}

/** A content-addressed reference to a large/binary payload (never inlined). */
export interface ArtifactRef {
  url: string;
  /** e.g. "sha256:abcd..." */
  hash: string;
  contentType: string;
  size: number;
}

/** JSON Schema document (kept loose here; validated at runtime by the worker/SDK). */
export type JsonSchema = Record<string, unknown>;

/**
 * How an agent interacts with a service, orthogonal to how it is paid:
 * - sync: one request, one response, within a timeout (the only shape today).
 * - async: the provider returns a durable handle; the worker polls until done.
 * - human: a person does or approves the work (held until approval/milestone).
 * - metered: pay-per-call or streaming (x402 / MPP), not escrowed per hire.
 */
export type ServiceInteraction = 'sync' | 'async' | 'human' | 'metered';

/** How a service is paid, orthogonal to its interaction shape. */
export type PaymentModel = 'escrow' | 'x402' | 'mpp-session' | 'subscription';

/** A declared requirement for input attachments the buyer must supply to hire. */
export interface AttachmentSpec {
  /** At least one attachment is required. */
  required?: boolean;
  /** Accepted content types, e.g. ["application/pdf", "image/*"]. */
  accept?: string[];
  /** Max bytes per attachment. */
  maxSizeBytes?: number;
  /** Max number of attachments. */
  maxCount?: number;
}

/**
 * A usage requirement the BUYER must satisfy before hiring, that a prompt cannot
 * carry: an authorization/OAuth, an app install, an API key/credential, or setup info
 * (a repo name, a channel id). The agent checks these before a hire and asks the user
 * to complete any unmet one. A `secret` value is stored encrypted and passed to the
 * provider at job time, never to the model.
 */
export type PrerequisiteKind = 'info' | 'apiKey' | 'install' | 'oauth';
export interface Prerequisite {
  kind: PrerequisiteKind;
  /** Stable key the provider reads the satisfied value under, e.g. "github_token". */
  key: string;
  /** Short label shown to the buyer, e.g. "GitHub access token". */
  label: string;
  /** What the buyer must do (shown in the usage-requirements UI). */
  instructions: string;
  /** For install/oauth: a URL the buyer visits to set it up. */
  url?: string;
  /** True for a credential/token: stored encrypted, passed to the provider, never shown. */
  secret?: boolean;
}

/**
 * How a single function is billed, orthogonal to the service's escrow/metered shape.
 * - free: no charge.
 * - per_call: a fixed amount each invocation.
 * - per_usage: metered by a unit (tokens, MB, rows); `amount` is the unit price.
 * - subscription: a recurring amount per `period`.
 */
export type PricingKind = 'free' | 'per_call' | 'per_usage' | 'subscription';
export interface FunctionPricing {
  model: PricingKind;
  /** Price in `currency`; omitted or 0 when free. */
  amount?: number;
  currency?: 'USDC';
  /** For per_usage, the billing unit, e.g. "1k tokens", "MB", "row". */
  unit?: string;
  /** For subscription, the billing period. */
  period?: 'day' | 'week' | 'month';
}

/**
 * One callable operation of a service. A service exposes one or more; each carries
 * its OWN input/output spec, usage requirements, and pricing, so a buyer can use the
 * functions they qualify for and is gated only on the ones with unmet requirements.
 * `key` equals the `action` the worker dispatches to the endpoint.
 */
export interface ServiceFunction {
  key: string;
  label: string;
  description?: string;
  input?: JsonSchema;
  output?: JsonSchema;
  /** Requirement keys (from the service's `prerequisites` catalog) this function needs. */
  requires?: string[];
  pricing: FunctionPricing;
  /** Verification tier for this function's delivery; absent inherits the service tier. */
  tier?: Tier;
  verification?: VerificationSpec;
  interaction?: ServiceInteraction;
}

/** Public contact and identity links for a service (and, by extension, its owner). */
export interface ContactLinks {
  website?: string;
  docs?: string;
  /** Email or URL for support. */
  support?: string;
  github?: string;
  x?: string;
  discord?: string;
}

/** The lifecycle status a provider reports for a step (MCP Tasks vocabulary). */
export type ResultStatus = 'completed' | 'working' | 'input_required' | 'failed';

/** A typed question a provider asks mid-job; the answer resumes the job. */
export interface InputRequest {
  /** Correlates the question with its answer. */
  requestId: string;
  /** The prompt put to the user or agent. */
  prompt: string;
  /** Optional JSON Schema the answer must satisfy. */
  schema?: JsonSchema;
}

/**
 * The provider's full acceptance contract. Registered once, hashed, and anchored
 * on-chain; editing bumps `version` and re-anchors (anti bait-and-switch).
 */
export interface ServiceManifest {
  id: string;
  name: string;
  category: string;
  tier: Tier;
  description: string;
  capabilities: string[];
  pricing: { model: 'direct' | 'x402' | 'mpp'; pricePerCall: number; currency: 'USDC' };
  /** Stellar address that receives payment (ownership proven at registration). */
  payout: string;
  io: { input: JsonSchema; output: JsonSchema };
  verification: VerificationSpec;
  /** Dispute window in seconds; 0 for T1 (instant). */
  dispute?: { windowSec: number };
  /** Optional slashable stake (phased). */
  bond?: { amount: number; asset: 'USDC' };
  healthCheck?: string;
  /** Max acceptable latency (ms) before the job fails and the lock refunds. */
  slaMaxLatencyMs?: number;
  /** Bumped on every manifest edit; earned trust is annotated with the version. */
  version: number;
  /** Interaction shape; absent means 'sync' (back-compat with existing manifests). */
  interaction?: ServiceInteraction;
  /** Payment model; absent means 'escrow'. */
  paymentModel?: PaymentModel;
  /** Input-attachment requirement, when the service needs files on input. */
  attachmentsIn?: AttachmentSpec;
  /**
   * The service's requirement CATALOG: every usage requirement any function may need
   * (auth/install/key/info). A function references these by key in `requires`; a buyer
   * is gated per function, not for the whole service.
   */
  prerequisites?: Prerequisite[];
  /**
   * The callable functions. A single-function service may omit this (the top-level
   * io/pricing/tier describe its one operation); a multi-function service lists each
   * with its own requirements and pricing.
   */
  functions?: ServiceFunction[];
  /** Public contact/identity links (website, docs, support, socials). */
  contactLinks?: ContactLinks;
  /** The service may ask the user a question mid-job (elicitation). */
  mayElicit?: boolean;
  /** The service streams a metered result (per-tick billing). */
  streaming?: boolean;
}

/** What the worker POSTs to a provider endpoint to request a job. */
export interface JobRequestEnvelope {
  jobId: string;
  taskId: string;
  stepId: string;
  /** Must be one of the manifest's capabilities. */
  action: string;
  /** Validates against manifest.io.input. */
  input: Record<string, unknown>;
  /** Buyer-supplied inputs, by reference, never large-inline. */
  attachments?: ArtifactRef[];
  /**
   * The buyer's satisfied usage-requirement values (keyed by Prerequisite.key): an API
   * key/token, an OAuth marker, or setup info. Sent to the PROVIDER so it can act on the
   * buyer's behalf; secret values are decrypted server-side and never exposed to the LLM.
   */
  credentials?: Record<string, string>;
  replyFormat: 'json' | 'text' | 'reference';
  /** Unix seconds; past it the job fails and the lock refunds (never hang). */
  deadline: number;
  /** A retried hire with the same key never double-charges. */
  idempotencyKey: string;
  /**
   * What this call does. Absent/`dispatch` starts a job; `poll` checks an async
   * handle; `answer` resumes an input_required step. Back-compat: absent = dispatch.
   */
  kind?: 'dispatch' | 'poll' | 'answer';
  /** The provider's durable job handle, sent on a `poll`. */
  handle?: string;
  /** On an `answer`: the InputRequest being answered and the response payload. */
  requestId?: string;
  inputResponse?: Record<string, unknown>;
}

/** The standard envelope a provider returns, so the pipeline is uniform. */
export interface JobResultEnvelope {
  ok: boolean;
  contentType: string;
  /** Inline small result (JSON or text). */
  data?: unknown;
  /** Large/binary result, by reference. */
  artifact?: ArtifactRef;
  /** Set when ok is false. */
  error?: string;
  issuedAt: number;
  /** Optional: provider signature over jobId|hash(input)|hash(output)|issuedAt. */
  signature?: string;
  /**
   * Lifecycle status (MCP Tasks vocabulary). Absent means `completed` when ok, else
   * `failed`. `working` returns a `handle` to poll; `input_required` returns an
   * `inputRequest` to put to the user.
   */
  status?: ResultStatus;
  /** For an async job: the durable handle the worker polls. */
  handle?: string;
  /** Optional progress for a working async job. */
  progress?: { pct?: number; message?: string };
  /** For input_required: the typed question to put to the user or agent. */
  inputRequest?: InputRequest;
}
