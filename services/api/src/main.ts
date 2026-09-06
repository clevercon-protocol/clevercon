import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppEnv } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Allow the SPA (dev on :5173, and the deployed origin) to call the API.
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();
  const config = app.get(ConfigService<AppEnv, true>);
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  console.log(`[api] listening on :${port} (network=${config.get('NETWORK', { infer: true })})`);
}

void bootstrap();
