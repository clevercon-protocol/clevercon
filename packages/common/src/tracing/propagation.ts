import {
  context,
  propagation,
  type Context,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';

const headerGetter: TextMapGetter<Record<string, unknown>> = {
  keys(carrier) {
    return Object.keys(carrier);
  },

  get(carrier, key) {
    const value = carrier[key];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value as string | undefined;
  },
};

const headerSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

export function injectTraceContext(
  headers: Record<string, string> = {},
): Record<string, string> {
  propagation.inject(context.active(), headers, headerSetter);

  return headers;
}

export function extractTraceContext(
  headers: Record<string, unknown>,
): Context {
  try {
    return propagation.extract(
      context.active(),
      headers,
      headerGetter,
    );
  } catch {
    /**
     * A malformed traceparent must never break an agent request.
     *
     * Return the current context so the caller can start a new root span.
     */
    return context.active();
  }
}