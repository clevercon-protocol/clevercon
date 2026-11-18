import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The current session's user, roles, and wallets. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.userId);
  }
}
