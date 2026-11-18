import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { PoliciesService } from './policies.service.js';
import { PoliciesController } from './policies.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule], // JWT (console) or x-api-key (agents)
  controllers: [PoliciesController],
  providers: [PoliciesService, ApiAuthGuard],
  exports: [PoliciesService],
})
export class PoliciesModule {}
