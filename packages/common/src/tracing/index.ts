import {
  context,
  propagation,
  trace,
  Span,
  SpanStatusCode,
  type Context,
} from '@opentelemetry/api';

export const TRACER_NAME = 'clevercon';

export const tracer = trace.getTracer(TRACER_NAME);

export function startSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> | T {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      throw error;
    } finally {
      span.end();
    }
  });
}