import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import type { VerificationSpec, JobResultEnvelope, JsonSchema } from './service-manifest.js';

/**
 * Server-side (worker) verification of a service's delivery, matched to its
 * declared verification method. Mirrors the buyer-side SDK copy in
 * packages/agent-sdk/src/verifier.ts; KEEP THE CHECK SEMANTICS IN SYNC. See
 * .local/MARKETPLACE-ECONOMY-SPEC.md sections 3-5.
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export type WitnessPredicate = (input: Record<string, unknown>, data: unknown) => boolean;

/** Named trustless witness checks for method `witness` (extend via options). */
export const WITNESS_PREDICATES: Record<string, WitnessPredicate> = {
  // The returned factors multiply back to the requested product.
  product: (input, data) => {
    const d = data as { a?: number; b?: number } | null;
    return (
      !!d && typeof d.a === 'number' && typeof d.b === 'number' && d.a * d.b === Number(input.n)
    );
  },
  // The returned digest is sha256 of the requested data (re-hashed and compared,
  // so a notary/commitment service cannot be paid for a wrong hash).
  sha256: (input, data) => {
    const d = data as { sha256?: string } | null;
    const src = input.data;
    if (!d?.sha256 || typeof src !== 'string') return false;
    return createHash('sha256').update(src).digest('hex') === d.sha256;
  },
};

export interface VerifyOptions {
  /** For method `onchain`: independently re-derive the expected answer from input. */
  derive?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  predicates?: Record<string, WitnessPredicate>;
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** The message a provider signs and the server verifies for method `signature`. */
export function resultSigningPayload(output: JobResultEnvelope): string {
  const body = output.data !== undefined ? stable(output.data) : (output.artifact?.hash ?? '');
  return `${output.issuedAt}:${body}`;
}

/** Minimal JSON Schema subset validator (type, required, properties, array items). */
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
 * Run a service's declared verification against a delivery. Trustless for the
 * Tier-1 methods; attest/manual return ok (their gate is the dispute window /
 * human approval, handled elsewhere). `onchain` without a `derive` returns a
 * `deferred` result so the caller can choose to pass it to buyer-side verification.
 */
export async function verifyDelivery(
  verification: VerificationSpec,
  input: Record<string, unknown>,
  output: JobResultEnvelope,
  opts: VerifyOptions = {},
): Promise<VerifyResult & { deferred?: boolean }> {
  if (!output.ok) return { ok: false, reason: output.error ?? 'provider returned not-ok' };
  const spec = verification.spec ?? {};
  switch (verification.method) {
    case 'attest':
    case 'manual':
      return { ok: true };
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
      if (!opts.derive)
        return { ok: true, deferred: true, reason: 'onchain verification deferred to buyer' };
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
      return { ok: true };
  }
}
