import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { AgentService } from './agent.service.js';
import { AgentController } from './agent.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule, VaultModule, PoliciesModule],
  controllers: [AgentController],
  providers: [AgentService, ApiAuthGuard],
})
export class AgentModule {}
