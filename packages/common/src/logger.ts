import { trace } from '@opentelemetry/api';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface TraceContext {
  traceId?: string;
  spanId?: string;
}

function getTraceContext(): TraceContext {
  const span = trace.getActiveSpan();

  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();

  if (!spanContext.traceId) {
    return {};
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

function log(level: LogLevel, message: string, data?: unknown) {
  const ts = new Date().toISOString();
  const traceContext = getTraceContext();

  const prefix = `[${ts}] [${level.toUpperCase()}]`;

  const context =
    Object.keys(traceContext).length > 0
      ? traceContext
      : undefined;

  if (data !== undefined && context !== undefined) {
    console.log(
      `${prefix} ${message}`,
      {
        ...context,
        data,
      },
    );
    return;
  }

  if (data !== undefined) {
    console.log(
      `${prefix} ${message}`,
      data,
    );
    return;
  }

  if (context !== undefined) {
    console.log(
      `${prefix} ${message}`,
      context,
    );
    return;
  }

  console.log(`${prefix} ${message}`);
}

export const logger = {
  info: (msg: string, data?: unknown) =>
    log('info', msg, data),

  warn: (msg: string, data?: unknown) =>
    log('warn', msg, data),

  error: (msg: string, data?: unknown) =>
    log('error', msg, data),

  debug: (msg: string, data?: unknown) =>
    log('debug', msg, data),
};