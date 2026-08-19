import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import {
  OTLPTraceExporter,
} from '@opentelemetry/exporter-trace-otlp-proto';

import {
  NodeSDK,
} from '@opentelemetry/sdk-node';

import {
  getTracingConfig,
} from './config';

let sdk: NodeSDK | undefined;

let initialized = false;

export function initializeTracing(): NodeSDK | undefined {
  if (initialized) {
    return sdk;
  }

  initialized = true;

  const config = getTracingConfig();

  /**
   * Tracing disabled:
   *
   * Do not register a provider.
   *
   * @opentelemetry/api therefore uses its no-op implementation.
   */
  if (!config.enabled) {
    return undefined;
  }

  const exporter =
    config.exporter === 'otlp'
      ? new OTLPTraceExporter({
          ...(config.otlpEndpoint
            ? {
                url: config.otlpEndpoint,
              }
            : {}),
        })
      : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    spanProcessor: new SimpleSpanProcessor(exporter),
    serviceName: config.serviceName,
  });

  sdk.start();

  return sdk;
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();

  sdk = undefined;
  initialized = false;
}