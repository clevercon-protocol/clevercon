import { Controller, Get, UseGuards } from '@nestjs/common';
import { VaultService } from './vault.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

/** The current session's vault position (aggregated across their wallets). */
@Controller('vault')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthUser) {
    return this.vault.getForUser(user.userId);
  }
}
