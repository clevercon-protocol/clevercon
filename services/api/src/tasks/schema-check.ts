/**
 * Minimal JSON Schema subset validator (type, required, properties, array items),
 * an API-LOCAL copy of validateSchema from @clevercon/common.
 *
 * Why a copy: @clevercon/common ships as raw TS source (main -> src/index.ts) and
 * is consumed at runtime only by the tsx-run worker. The API runs compiled with
 * plain Node (`node dist/src/main.js`), which cannot load a `.ts` file, so the API
 * must not import any VALUE from common (type-only imports are erased and are
 * fine). Keep the check semantics in sync with common/src/service-verify.ts.
 */
export type SchemaDoc = Record<string, unknown>;

export interface SchemaCheck {
  ok: boolean;
  reason?: string;
}

export function validateAgainstSchema(value: unknown, schema: SchemaDoc | undefined): SchemaCheck {
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
    const props = (schema.properties as Record<string, SchemaDoc>) ?? {};
    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) {
        const r = validateAgainstSchema(obj[k], sub);
        if (!r.ok) return { ok: false, reason: `${k}: ${r.reason}` };
      }
    }
  }
  if (type === 'array' && Array.isArray(value) && schema.items) {
    for (const item of value) {
      const r = validateAgainstSchema(item, schema.items as SchemaDoc);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}
