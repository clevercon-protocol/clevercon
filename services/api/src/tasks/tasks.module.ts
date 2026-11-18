import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';
import { PaymentsController } from '../payments/payments.controller.js';

@Module({
  // JWT-or-API-key auth + vault lock + policy derivation for the payment primitive.
  imports: [AuthModule, VaultModule, ApiKeysModule, PoliciesModule],
  controllers: [TasksController, PaymentsController],
  providers: [TasksService, ApiAuthGuard],
  exports: [TasksService],
})
export class TasksModule {}
