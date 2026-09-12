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
const agentWalletSchema = z.object({ publicKey: z.string().min(1) });

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

  /** The caller's delegate address, whether settlement is enabled, and if authorized. */
  @Get('delegate')
  delegate(@CurrentUser() user: AuthUser) {
    return this.vault.getDelegate(user.userId);
  }

  /**
   * Build the one-time register_orchestrator XDR authorizing the caller's own
   * delegate to spend within their policy. Signed in the wallet and submitted
   * via /vault/submit, like deposit/withdraw.
   */
  @Post('delegate/register')
  registerDelegate(@CurrentUser() user: AuthUser) {
    return this.vault.buildRegisterOrchestrator(user.userId);
  }

  /** Confirm the delegate was authorized on-chain (called after the register tx). */
  @Post('delegate/confirm')
  confirmDelegate(@CurrentUser() user: AuthUser) {
    return this.vault.confirmDelegateRegistered(user.userId);
  }

  /** The caller's registered agent key (public key only), for agent-key mode. */
  @Get('agent-wallet')
  getAgentWallet(@CurrentUser() user: AuthUser) {
    return this.vault.getAgentWallet(user.userId);
  }

  /** Register the caller's own agent key. Only the public key is stored. */
  @Post('agent-wallet')
  setAgentWallet(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { publicKey } = parseBody(agentWalletSchema, body);
    return this.vault.setAgentWallet(user.userId, publicKey);
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
