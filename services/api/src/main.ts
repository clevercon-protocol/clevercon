// Must be first: starts OpenTelemetry (when configured) before any instrumented
// library (express/pg/ioredis) is imported by the rest of the app.
import './tracing.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppEnv } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  // bufferLogs holds early logs until the pino logger is wired in below, so the
  // whole boot sequence is captured in the structured format.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Allow the SPA (dev on :5173, and the deployed origin) to call the API.
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();
  const config = app.get(ConfigService<AppEnv, true>);
  // Behind a load balancer, trust the configured number of proxy hops so the
  // rate limiter keys on the real client IP (X-Forwarded-For) not the proxy's.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  app
    .get(Logger)
    .log(
      `API listening on :${port} (network=${config.get('NETWORK', { infer: true })})`,
      'Bootstrap',
    );
}

void bootstrap();
