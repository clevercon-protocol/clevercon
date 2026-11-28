import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.validation.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Transactional email via Resend (P4). Dormant until RESEND_API_KEY is set: `enabled`
 * is false and `send` is a no-op, so the app runs identically with in-app notifications
 * only. Sends are best-effort - a failure is logged and swallowed, never breaking the
 * action that raised the notification.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly apiKey?: string;
  private readonly from: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.from = config.get('RESEND_FROM', { infer: true });
  }

  /** Whether email delivery is configured (a Resend key is present). */
  get enabled(): boolean {
    return !!this.apiKey;
  }

  /** Send one email. Returns true if accepted by Resend, false if disabled or failed. */
  async send(msg: MailMessage): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Resend send failed (${res.status})`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Resend send errored: ${(err as Error).message}`);
      return false;
    }
  }
}
