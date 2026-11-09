import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { ServicesService } from './services.service.js';
import { ServicesController } from './services.controller.js';

@Module({
  // VaultModule: the public protocol-fee read. AuthModule + ApiKeysModule + ApiAuthGuard:
  // JWT-or-API-key auth for the guarded /services/:id/setup endpoints (usage requirements).
  imports: [VaultModule, AuthModule, ApiKeysModule],
  controllers: [ServicesController],
  providers: [ServicesService, ApiAuthGuard],
  exports: [ServicesService],
})
export class ServicesModule {}
