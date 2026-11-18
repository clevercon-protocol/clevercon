import { Keypair } from '@stellar/stellar-sdk';
import type { ServiceManifest, JobResultEnvelope, JsonSchema } from './marketplace.js';

/**
 * Buyer-side verification of a service's delivery, matched to the manifest's tier
 * (see .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5). These run WITHOUT trusting
 * the provider, so an agent can check a Tier-1 result locally before accepting.
 * Tier-2/3 methods (attest/manual) fall back to a structural schema check; their
 * real gate is the dispute window / human approval, not a trustless proof.
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export type WitnessPredicate = (input: Record<string, unknown>, data: unknown) => boolean;

/**
 * Named, trustless witness checks for method `witness`: the output is hard to
 * produce but cheap to re-check here. Extend via `VerifyOptions.predicates`.
 */
export const WITNESS_PREDICATES: Record<string, WitnessPredicate> = {
  // The returned factors multiply back to the requested product.
  product: (input, data) => {
    const d = data as { a?: number; b?: number } | null;
    return (
      !!d && typeof d.a === 'number' && typeof d.b === 'number' && d.a * d.b === Number(input.n)
    );
  },
};

export interface VerifyOptions {
  /** For method `onchain`: independently re-derive the expected answer from input. */
  derive?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Extra witness predicates by name (merged over the built-ins). */
  predicates?: Record<string, WitnessPredicate>;
}

/** Deterministic JSON with sorted keys, so hashing/signing/compares are stable. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** The message a provider signs and a buyer verifies for method `signature`. */
export function resultSigningPayload(output: JobResultEnvelope): string {
  const body = output.data !== undefined ? stable(output.data) : (output.artifact?.hash ?? '');
  return `${output.issuedAt}:${body}`;
}

/**
 * Minimal JSON Schema subset validator (type, required, properties, array items).
 * Enough for manifest io checks; swap for ajv when schemas get richer.
 */
export function validateSchema(value: unknown, schema: JsonSchema | undefined): VerifyResult {
  if (!schema) return { ok: true };
  const type = schema.type as string | undefined;
  if (type) {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const want = type === 'integer' ? 'number' : type;
    if (actual !== want) return { ok: false, reason: `expected ${type}, got ${actual}` };
  }
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if ((type === 'object' || schema.properties) && isPlainObject) {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[]) ?? []) {
      if (!(k in obj)) return { ok: false, reason: `missing required: ${k}` };
    }
    const props = (schema.properties as Record<string, JsonSchema>) ?? {};
    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) {
        const r = validateSchema(obj[k], sub);
        if (!r.ok) return { ok: false, reason: `${k}: ${r.reason}` };
      }
    }
  }
  if (type === 'array' && Array.isArray(value) && schema.items) {
    for (const item of value) {
      const r = validateSchema(item, schema.items as JsonSchema);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}

/**
 * Verify a delivery against a manifest's declared verification method. Trustless
 * for Tier-1 methods (onchain/witness/content-hash/signature); structural only
 * for attest/manual (whose real gate is the dispute window / human approval).
 */
export async function verifyResult(
  manifest: ServiceManifest,
  input: Record<string, unknown>,
  output: JobResultEnvelope,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!output.ok) return { ok: false, reason: output.error ?? 'provider returned not-ok' };
  const v = manifest.verification;
  const spec = v.spec ?? {};
  switch (v.method) {
    case 'attest':
    case 'manual':
      return validateSchema(output.data, manifest.io.output);
    case 'content-hash': {
      const field = (spec.inputHashField as string) ?? 'hash';
      const expect = (spec.expect as string) ?? (input[field] as string | undefined);
      const got = output.artifact?.hash;
      if (!expect) return { ok: false, reason: 'no expected hash to check against' };
      return got === expect
        ? { ok: true }
        : { ok: false, reason: `hash mismatch: ${got} != ${expect}` };
    }
    case 'signature': {
      const key = (spec.signerKey as string) ?? '';
      if (!key || !output.signature)
        return { ok: false, reason: 'missing signer key or signature' };
      try {
        const ok = Keypair.fromPublicKey(key).verify(
          Buffer.from(resultSigningPayload(output)),
          Buffer.from(output.signature, 'base64'),
        );
        return ok ? { ok: true } : { ok: false, reason: 'signature invalid' };
      } catch (e) {
        return { ok: false, reason: `signature check failed: ${String(e)}` };
      }
    }
    case 'witness': {
      const name = (spec.predicate as string) ?? '';
      const pred = { ...WITNESS_PREDICATES, ...(opts.predicates ?? {}) }[name];
      if (!pred) return { ok: false, reason: `unknown witness predicate: ${name}` };
      try {
        return pred(input, output.data)
          ? { ok: true }
          : { ok: false, reason: 'witness check failed' };
      } catch (e) {
        return { ok: false, reason: `witness error: ${String(e)}` };
      }
    }
    case 'onchain': {
      if (!opts.derive) {
        return { ok: false, reason: 'onchain verification requires a deriver (wired in P1)' };
      }
      try {
        const expected = await opts.derive(input);
        return stable(expected) === stable(output.data)
          ? { ok: true }
          : { ok: false, reason: 'onchain re-derivation mismatch' };
      } catch (e) {
        return { ok: false, reason: `onchain derive failed: ${String(e)}` };
      }
    }
    default:
      return validateSchema(output.data, manifest.io.output);
  }
}

/** A verifier bound to one manifest: `(input, output) => Promise<VerifyResult>`. */
export function buildVerifier(manifest: ServiceManifest, opts?: VerifyOptions) {
  return (input: Record<string, unknown>, output: JobResultEnvelope) =>
    verifyResult(manifest, input, output, opts);
}
