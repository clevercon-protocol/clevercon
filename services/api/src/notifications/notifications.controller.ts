import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});
const readSchema = z.object({ ids: z.array(z.string().min(1)).max(100) });
const prefSchema = z.object({ type: z.string().min(1).max(64), email: z.boolean() });

/** A user's in-app notification feed. */
@Controller('notifications')
@UseGuards(ApiAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const { limit, offset, unreadOnly } = parseBody(listQuery, query);
    return this.notifications.list(user.userId, limit, offset, unreadOnly);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Post('read')
  read(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { ids } = parseBody(readSchema, body);
    return this.notifications.markRead(user.userId, ids);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId);
  }

  /** The user's per-event email preferences (in-app is always on). */
  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.userId);
  }

  @Post('preferences')
  setPreference(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { type, email } = parseBody(prefSchema, body);
    return this.notifications.setPreference(user.userId, type, email);
  }
}
