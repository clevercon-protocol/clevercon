import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProviderService } from './provider.service.js';
import { RegistryContractService } from './registry-contract.service.js';
import { ProviderController } from './provider.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [ProviderController],
  providers: [ProviderService, RegistryContractService],
  exports: [ProviderService],
})
export class ProviderModule {}
