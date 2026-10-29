import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FaucetService } from './faucet.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

/**
 * Testnet quickstart faucet. Behind the same auth as the vault (JWT console or
 * x-api-key). `status` lets the dapp decide whether to show a one-click button
 * or a fallback link; `usdc` sends the configured amount to the caller's wallet.
 */
@UseGuards(ApiAuthGuard)
@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucet: FaucetService) {}

  @Get('status')
  status() {
    return this.faucet.status();
  }

  @Post('usdc')
  claim(@CurrentUser() user: AuthUser) {
    return this.faucet.claim(user.userId);
  }
}
