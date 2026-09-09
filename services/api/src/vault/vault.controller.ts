import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { VaultService } from './vault.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { StepUpGuard } from '../auth/step-up.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const amountSchema = z.object({ amountUsdc: z.number().positive() });
const submitSchema = z.object({ signedXdr: z.string().min(1) });

/** The current session's vault position and on-chain deposit/withdraw. */
@Controller('vault')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.vault.getForUser(user.userId);
  }

  /** Deposit availability + the deployed vault contract address. */
  @Get('status')
  status() {
    return this.vault.status;
  }

  /**
   * Build an unsigned deposit XDR for the caller's wallet to sign. Requires a
   * fresh step-up wallet signature (x-stepup header) on top of the access token.
   */
  @Post('deposit')
  @UseGuards(StepUpGuard)
  deposit(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { amountUsdc } = parseBody(amountSchema, body);
    return this.vault.buildDeposit(user.userId, amountUsdc);
  }

  /**
   * Build an unsigned withdraw XDR for the caller's wallet to sign. Requires a
   * fresh step-up wallet signature (x-stepup header) on top of the access token.
   */
  @Post('withdraw')
  @UseGuards(StepUpGuard)
  withdraw(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { amountUsdc } = parseBody(amountSchema, body);
    return this.vault.buildWithdraw(user.userId, amountUsdc);
  }

  /** Submit a wallet-signed vault XDR (deposit or withdraw). */
  @Post('submit')
  submit(@Body() body: unknown) {
    const { signedXdr } = parseBody(submitSchema, body);
    return this.vault.submit(signedXdr);
  }
}
