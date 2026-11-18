import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

/**
 * OpenTelemetry tracing skeleton.
 *
 * This is imported first thing in main.ts so its instrumentations patch http,
 * express, ioredis and pg before those libraries are used. A single trace then
 * spans an incoming request through its DB and Redis calls, which is how you
 * debug latency and failures once many users are hitting the system at once.
 *
 * It stays a no-op until OTEL_EXPORTER_OTLP_ENDPOINT points at a collector, so
 * local runs and tests pay nothing and nothing is required to be running. Set
 * that env var (plus OTEL_SERVICE_NAME if you want) to turn it on.
 *
 * This module starts the SDK as an import side effect (see the call below) so
 * that importing it first in main.ts installs the instrumentation hooks before
 * express/pg/ioredis are pulled in by the rest of the app.
 */
export function startTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'clevercon-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new IORedisInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();
  const shutdown = () => {
    void sdk.shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startTracing();
