import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService], // disputes delivers API-originated events through it
})
export class WebhooksModule {}
