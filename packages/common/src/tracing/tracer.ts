import {
  context,
  Span,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type SpanOptions,
} from '@opentelemetry/api';

export const TRACER_NAME = 'clevercon';

export const tracer = trace.getTracer(TRACER_NAME);

export type SpanAttributeValue =
  | string
  | number
  | boolean
  | undefined;

export type SpanAttributes = Record<
  string,
  SpanAttributeValue
>;

function sanitizeAttributes(
  attributes?: SpanAttributes,
): Attributes {
  if (!attributes) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([, value]) => value !== undefined,
    ),
  ) as Attributes;
}

export interface RunSpanOptions {
  attributes?: SpanAttributes;
  context?: Context;
  spanOptions?: SpanOptions;
}

export async function runInSpan<T>(
  name: string,
  options: RunSpanOptions,
  operation: (span: Span) => Promise<T> | T,
): Promise<T> {
  const parentContext = options.context ?? context.active();

  return tracer.startActiveSpan(
    name,
    {
      ...(options.spanOptions ?? {}),
      attributes: sanitizeAttributes(options.attributes),
    },
    parentContext,
    async (span) => {
      try {
        return await operation(span);
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function recordSpanError(
  span: Span,
  error: unknown,
): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });

    return;
  }

  const message = String(error);

  span.recordException(new Error(message));

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
}

export function getActiveTraceId(): string | undefined {
  const activeSpan = trace.getActiveSpan();

  if (!activeSpan) {
    return undefined;
  }

  return activeSpan.spanContext().traceId;
}

export function getActiveSpanId(): string | undefined {
  const activeSpan = trace.getActiveSpan();

  if (!activeSpan) {
    return undefined;
  }

  return activeSpan.spanContext().spanId;
}

export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}