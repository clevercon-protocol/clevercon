import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { UsersModule } from './users/users.module.js';
import { ServicesModule } from './services/services.module.js';
import { VaultModule } from './vault/vault.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ProviderModule } from './provider/provider.module.js';
import { PoliciesModule } from './policies/policies.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    // Load the root .env whether the app runs from repo root or from services/api.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    QueueModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    ApiKeysModule,
    UsersModule,
    ServicesModule,
    VaultModule,
    TasksModule,
    ProviderModule,
    PoliciesModule,
  ],
})
export class AppModule {}
