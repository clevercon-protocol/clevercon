import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { EventsModule } from '../events/events.module.js';
import { MailModule } from '../mail/mail.module.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule, EventsModule, MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ApiAuthGuard],
  // Exported so Reviews/Disputes can raise feed notifications through one service.
  exports: [NotificationsService],
})
export class NotificationsModule {}
