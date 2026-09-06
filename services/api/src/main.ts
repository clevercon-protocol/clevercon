import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppEnv } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<AppEnv, true>);
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  console.log(`[api] listening on :${port} (network=${config.get('NETWORK', { infer: true })})`);
}

void bootstrap();
