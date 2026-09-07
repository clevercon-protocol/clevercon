import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VaultService } from './vault.service.js';
import { VaultContractService } from './vault-contract.service.js';
import { VaultController } from './vault.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [VaultController],
  providers: [VaultService, VaultContractService],
  exports: [VaultService],
})
export class VaultModule {}
