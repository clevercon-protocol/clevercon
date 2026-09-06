import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeyService } from './api-key.service.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysController } from './api-keys.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard used by the controller
  controllers: [ApiKeysController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
