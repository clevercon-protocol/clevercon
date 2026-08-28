/**
 * OpenTelemetry configuration.
 *
 * Tracing is intentionally disabled by default.
 *
 * Environment variables:
 *
 * OTEL_TRACING_ENABLED=true
 * OTEL_SERVICE_NAME=clevercon-orchestrator
 * OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
 * OTEL_TRACING_EXPORTER=console|otlp
 */

export type TracingExporter = 'console' | 'otlp';

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  exporter: TracingExporter;
  otlpEndpoint?: string;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function getExporter(): TracingExporter {
  const configured = process.env.OTEL_TRACING_EXPORTER?.toLowerCase();

  if (configured === 'otlp') {
    return 'otlp';
  }

  if (configured === 'console') {
    return 'console';
  }

  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'console';
}

export function getTracingConfig(): TracingConfig {
  return {
    enabled: parseBoolean(process.env.OTEL_TRACING_ENABLED),
    serviceName:
      process.env.OTEL_SERVICE_NAME?.trim() || 'clevercon-service',
    exporter: getExporter(),
    otlpEndpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined,
  };
}