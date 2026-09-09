import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppEnv } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
  console.log(`[api] listening on :${port} (network=${config.get('NETWORK', { infer: true })})`);
}

void bootstrap();
