import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { WebhooksService, WEBHOOK_EVENTS } from './webhooks.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
});

/** Developer webhooks: register URLs to receive signed event callbacks. */
@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { url, events } = parseBody(createSchema, body);
    return this.webhooks.create(user.userId, url, events ?? []);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.webhooks.list(user.userId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.remove(user.userId, id);
  }
}
