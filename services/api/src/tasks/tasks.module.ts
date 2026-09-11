import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [AuthModule, VaultModule, ApiKeysModule], // JWT-or-API-key auth + vault lock-on-hire
  controllers: [TasksController],
  providers: [TasksService, ApiAuthGuard],
  exports: [TasksService],
})
export class TasksModule {}
