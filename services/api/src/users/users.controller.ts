import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const emailSchema = z.object({ email: z.string().email().max(200) });
const verifySchema = z.object({ code: z.string().min(4).max(10) });

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The current session's user, roles, wallets, and email state. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.userId);
  }

  /** Set/change the notification email and send a verification code. */
  @Post('me/email')
  setEmail(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { email } = parseBody(emailSchema, body);
    return this.users.setEmail(user.userId, email);
  }

  /** Confirm the email with the code that was sent to it. */
  @Post('me/email/verify')
  verifyEmail(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { code } = parseBody(verifySchema, body);
    return this.users.verifyEmail(user.userId, code);
  }

  /** Remove the email and stop all email notifications. */
  @Delete('me/email')
  removeEmail(@CurrentUser() user: AuthUser) {
    return this.users.removeEmail(user.userId);
  }
}
