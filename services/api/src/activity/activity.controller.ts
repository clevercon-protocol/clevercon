import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

/** The current buyer's activity timeline (jobs + payments), newest first. */
@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.activity.forUser(user.userId);
  }
}
