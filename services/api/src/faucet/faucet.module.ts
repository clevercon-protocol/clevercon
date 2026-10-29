import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { FaucetService } from './faucet.service.js';
import { FaucetController } from './faucet.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule], // JWT (console) or x-api-key (agents)
  controllers: [FaucetController],
  providers: [FaucetService, ApiAuthGuard],
  exports: [FaucetService],
})
export class FaucetModule {}
