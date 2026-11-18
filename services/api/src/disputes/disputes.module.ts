import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { VaultModule } from '../vault/vault.module.js';
import { EventsModule } from '../events/events.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { DisputesService } from './disputes.service.js';
import { DisputesController } from './disputes.controller.js';

@Module({
  // VaultModule exports VaultContractService; Events/Webhooks power the
  // two-channel dispute notifications (real-time socket + webhook).
  imports: [AuthModule, ApiKeysModule, VaultModule, EventsModule, WebhooksModule],
  controllers: [DisputesController],
  providers: [DisputesService, ApiAuthGuard],
})
export class DisputesModule {}
