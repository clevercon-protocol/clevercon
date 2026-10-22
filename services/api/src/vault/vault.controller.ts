import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { VaultService } from './vault.service.js';
import { QueueService } from '../queue/queue.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { StepUpGuard } from '../auth/step-up.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const amountSchema = z.object({ amountUsdc: z.number().positive() });
const submitSchema = z.object({ signedXdr: z.string().min(1) });
const pinSchema = z.object({ commitment: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const agentWalletSchema = z.object({ publicKey: z.string().min(1) });

const hex = z.string().regex(/^[0-9a-fA-F]+$/);
// A pp/2 batch release: the client proved locally and POSTs this; the API relays
// it to the worker, which submits release_payment_proved_batch. Up to N=4 legs.
const batchReleaseSchema = z.object({
  vaultTaskId: z.string().nullable(),
  planCostUsdc: z.number().positive(),
  stepId: z.number().int().nonnegative(),
  payees: z.array(z.string().min(1)).min(1).max(4),
  amounts: z.array(z.string().min(1)).min(1).max(4),
  nullifiers: z.array(hex).min(1).max(4),
  validAfter: z.string().min(1),
  validBefore: z.string().min(1),
  commitment: hex,
  // Proven tumbling-window reset flags (circuit outputs); the vault needs them to
  // reconstruct the public signals and roll the per-commitment R2/R7 accumulators.
  resetR2: z.boolean(),
  resetR7: z.boolean(),
  proof: z.object({ a: hex, b: hex, c: hex }),
});

/** The current session's vault position and on-chain deposit/withdraw. */
@Controller('vault')
@UseGuards(ApiAuthGuard) // JWT (console) or x-api-key (agents); deposit/withdraw add StepUpGuard
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly queue: QueueService,
  ) {}

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

  /**
   * Build the set_policy_commitment XDR pinning a rule's 32-byte commitment to
   * the caller's account; signed in the wallet and submitted via /vault/submit.
   * The wallet signature is the authorization (no step-up: it moves no funds).
   */
  @Post('pin-commitment')
  pinCommitment(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { commitment } = parseBody(pinSchema, body);
    return this.vault.buildPinCommitment(user.userId, commitment);
  }

  /**
   * The per-commitment R2/R7 accumulator (window spend/count + anchors) a client
   * reads BEFORE proving a pp/2 batch, so the proof binds to the window state the
   * vault re-derives at settlement. A fresh commitment reads back zeros.
   */
  @Get('accumulator/:commitment')
  accumulator(@Param('commitment') commitment: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(commitment)) {
      throw new BadRequestException('commitment must be 32-byte hex (64 chars)');
    }
    return this.vault.getCommitmentAccumulator(commitment);
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

  /**
   * pp/2 trustless batch release: the caller proved their private policy
   * client-side (the plaintext never leaves them) and POSTs the proof + the
   * payouts here. The API only relays, it validates the shape and enqueues the
   * worker, which submits release_payment_proved_batch with the buyer's delegate
   * (a relayer that cannot forge the proof). The chain verifies the proof.
   */
  @Post('batch-release-proved')
  async batchReleaseProved(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const req = parseBody(batchReleaseSchema, body);
    if (req.payees.length !== req.amounts.length || req.payees.length !== req.nullifiers.length) {
      throw new BadRequestException('payees, amounts, and nullifiers must be equal length');
    }
    const jobId = await this.queue.enqueueBatchRelease({
      buyerId: user.userId,
      vaultTaskId: req.vaultTaskId,
      commitmentHex: req.commitment,
      planCostUsdc: req.planCostUsdc,
      stepId: req.stepId,
      payees: req.payees,
      amountsStroops: req.amounts,
      nullifiers: req.nullifiers,
      validAfter: req.validAfter,
      validBefore: req.validBefore,
      resetR2: req.resetR2,
      resetR7: req.resetR7,
      proof: req.proof,
    });
    return { jobId, status: 'queued' };
  }

  /**
   * Poll a batch-release job for its real outcome, so the UI can show a true
   * "Completed" / "Failed" rather than a premature "Accepted". The jobId embeds
   * the owner's id (`batch-<userId>-<stepId>`), so a caller can only read their
   * own jobs.
   */
  @Get('batch-job/:jobId')
  async batchJob(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    if (!jobId.startsWith(`batch-${user.userId}-`)) {
      throw new ForbiddenException('not your job');
    }
    return (await this.queue.getBatchJob(jobId)) ?? { state: 'unknown', result: null };
  }
}
