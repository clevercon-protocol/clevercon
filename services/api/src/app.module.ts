import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';

@Module({
  imports: [
    // Load the root .env whether the app runs from repo root or from services/api.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ApiKeysModule,
  ],
})
export class AppModule {}
