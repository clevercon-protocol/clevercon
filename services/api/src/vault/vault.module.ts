import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { VaultService } from './vault.service.js';
import { VaultContractService } from './vault-contract.service.js';
import { DelegateService } from './delegate.service.js';
import { VaultController } from './vault.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule], // JWT (console) or x-api-key (agents)
  controllers: [VaultController],
  providers: [VaultService, VaultContractService, DelegateService, ApiAuthGuard],
  exports: [VaultService, VaultContractService, DelegateService],
})
export class VaultModule {}
