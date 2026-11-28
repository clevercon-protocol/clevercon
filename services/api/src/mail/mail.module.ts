import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';

/** Provides the Resend-backed mailer (dormant until RESEND_API_KEY is set). */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
