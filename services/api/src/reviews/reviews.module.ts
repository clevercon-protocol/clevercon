import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { EventsModule } from '../events/events.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ReviewsService } from './reviews.service.js';
import { ReviewsController, ServiceReviewsController } from './reviews.controller.js';

@Module({
  // Events/Webhooks power the two-channel review notifications (socket + webhook).
  imports: [AuthModule, ApiKeysModule, EventsModule, WebhooksModule],
  controllers: [ReviewsController, ServiceReviewsController],
  providers: [ReviewsService, ApiAuthGuard],
})
export class ReviewsModule {}
