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
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const amountSchema = z.object({ amountUsdc: z.number().positive() });
const submitSchema = z.object({ signedXdr: z.string().min(1) });
const pinSchema = z.object({ commitment: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const agentWalletSchema = z.object({ publicKey: z.string().min(1) });
// A named cleartext PUBLIC rule: the full clause vocabulary the vault checks directly
// on each session spend. Each field is independently optional (0 / empty = no
// constraint on that axis). Identified by a 32-byte rule id.
const rid64 = z.string().regex(/^[0-9a-fA-F]{64}$/);
const publicRuleSchema = z.object({
  perPaymentMaxUsdc: z.number().nonnegative(),
  perPaymentMinUsdc: z.number().nonnegative(),
  rollingCapUsdc: z.number().nonnegative(),
  rollingWindowSecs: z.number().int().nonnegative(),
  velocityMax: z.number().int().nonnegative(),
  velocityWindowSecs: z.number().int().nonnegative(),
  allowlist: z
    .array(z.object({ addr: z.string().min(1), capUsdc: z.number().nonnegative() }))
    .max(32),
  denylist: z.array(z.string().min(1)).max(32),
  denylistThresholdUsdc: z.number().nonnegative(),
  calendarStart: z.number().int().nonnegative(),
  calendarEnd: z.number().int().nonnegative(),
});
const setPublicRuleSchema = z.object({ ruleId: rid64, rule: publicRuleSchema });
const ruleIdOnlySchema = z.object({ ruleId: rid64 });

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

// A pp/2 KEYLESS batch release: the client proved locally and POSTs this; the API
// submits release_proved_keyless via a fee-payer relayer (NO delegate). The user is
// taken from the session, not the body. `global` is the second proof the vault
// requires when a global-private rule is set; omit it otherwise. No task fields: the
// keyless path draws from the user's balance directly.
const globalProofSchema = z.object({
  commitment: hex,
  nullifiers: z.array(hex).min(1).max(4),
  resetR2: z.boolean(),
  resetR7: z.boolean(),
  proof: z.object({ a: hex, b: hex, c: hex }),
});
const batchReleaseKeylessSchema = z.object({
  payees: z.array(z.string().min(1)).min(1).max(4),
  amounts: z.array(z.string().min(1)).min(1).max(4),
  nullifiers: z.array(hex).min(1).max(4),
  validAfter: z.string().min(1),
  validBefore: z.string().min(1),
  commitment: hex,
  resetR2: z.boolean(),
  resetR7: z.boolean(),
  proof: z.object({ a: hex, b: hex, c: hex }),
  global: globalProofSchema.nullish(),
});

// Managed Sessions (server + public): the owner authorizes a server-held key with a
// total spend cap + expiry (no allowlist; it pays any payee up to the cap).
const sessionEnableSchema = z.object({
  spendCapUsdc: z.number().positive(),
  expiresInSeconds: z.number().int().positive(),
  // The public rule the Managed Session runs under (bound on-chain), OPTIONAL - a
  // cap-only session is valid; a rule adds clause limits on top.
  ruleId: rid64.optional(),
});
const sessionUpdateSchema = z.object({
  newExpiresInSeconds: z.number().int().nonnegative(),
  newSpendCapUsdc: z.number().nonnegative(),
});
const sessionPauseSchema = z.object({ paused: z.boolean() });

// Self-custody agent keys: the owner authorizes an arbitrary key bound to a public
// rule (+ optional cap / expiry). sessionPublicKey is any G... address.
const gAddr = z.string().regex(/^G[A-Z2-7]{55}$/);
const agentKeyRegisterSchema = z.object({
  sessionPublicKey: gAddr,
  // Rule optional; a cap and/or a rule is required (the service enforces it).
  ruleId: rid64.optional(),
  spendCapUsdc: z.number().nonnegative().optional(),
  expiresInSeconds: z.number().int().nonnegative().optional(),
});
const agentKeyOnlySchema = z.object({ sessionPublicKey: gAddr });
const agentKeyPauseSchema = z.object({ sessionPublicKey: gAddr, paused: z.boolean() });
const sessionPayBodySchema = z.object({
  payee: z.string().min(1),
  amount: z.number().positive(),
  // The public rule selected for this spend (per task). Omit for a cap-only spend.
  ruleId: rid64.optional(),
});

/** The current session's vault position and on-chain deposit/withdraw. */
@Controller('vault')
@UseGuards(ApiAuthGuard) // JWT (console) or x-api-key (agents)
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

  /** Build the wallet-signed unpin XDR (removes a rule from the on-chain pinned set). */
  @Post('unpin-commitment')
  unpinCommitment(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { commitment } = parseBody(pinSchema, body);
    return this.vault.buildUnpinCommitment(user.userId, commitment);
  }

  /** The caller's on-chain pinned-commitment set, so the dapp marks which rules are live. */
  @Get('pinned-commitments')
  pinnedCommitments(@CurrentUser() user: AuthUser) {
    return this.vault.getPinnedCommitments(user.userId);
  }

  // ── Global rules (AND-filter applied to every spend in a lane) ───────────────

  /** The caller's current globals: the private commitment (hex) + the public scope. */
  @Get('globals')
  globals(@CurrentUser() user: AuthUser) {
    return this.vault.getGlobals(user.userId);
  }

  /** Build the wallet-signed set_global(Private, commitment) XDR (make a rule global). */
  @Post('global/private/set')
  setGlobalPrivate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { commitment } = parseBody(pinSchema, body);
    return this.vault.buildSetGlobalPrivate(user.userId, commitment);
  }

  /** Build the wallet-signed clear_global(Private) XDR. */
  @Post('global/private/clear')
  clearGlobalPrivate(@CurrentUser() user: AuthUser) {
    return this.vault.buildClearGlobalPrivate(user.userId);
  }

  /** Build the wallet-signed set_public_rule XDR (store a named cleartext public rule). */
  @Post('public-rule/set')
  setPublicRule(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { ruleId, rule } = parseBody(setPublicRuleSchema, body);
    return this.vault.buildSetPublicRule(user.userId, ruleId, rule);
  }

  /** Build the wallet-signed clear_public_rule XDR. */
  @Post('public-rule/clear')
  clearPublicRule(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { ruleId } = parseBody(ruleIdOnlySchema, body);
    return this.vault.buildClearPublicRule(user.userId, ruleId);
  }

  /** Read a named public rule (USDC / seconds) + its live usage. */
  @Get('public-rule/:ruleId')
  async publicRule(@CurrentUser() user: AuthUser, @Param('ruleId') ruleId: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(ruleId)) throw new BadRequestException('rule id must be 64-hex');
    const [rule, usage] = await Promise.all([
      this.vault.getPublicRule(user.userId, ruleId),
      this.vault.getPublicUsage(user.userId, ruleId),
    ]);
    return { rule, usage };
  }

  /** Build the wallet-signed set_global_public(rule_id) XDR (mark a public rule global). */
  @Post('global/public/set')
  setGlobalPublic(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { ruleId } = parseBody(ruleIdOnlySchema, body);
    return this.vault.buildSetGlobalPublic(user.userId, ruleId);
  }

  /** Build the wallet-signed clear_global_public XDR. */
  @Post('global/public/clear')
  clearGlobalPublic(@CurrentUser() user: AuthUser) {
    return this.vault.buildClearGlobalPublic(user.userId);
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
   * Build an unsigned deposit XDR for the caller's wallet to sign. No step-up: this
   * only returns an UNSIGNED XDR, and the deposit cannot move a cent until the wallet
   * signs that exact operation (the contract enforces `user.require_auth()`). The
   * wallet signature on the real op is the authorization, so a second step-up
   * signature would be pure friction with no added security (one wallet prompt, not
   * two).
   */
  @Post('deposit')
  deposit(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { amountUsdc } = parseBody(amountSchema, body);
    return this.vault.buildDeposit(user.userId, amountUsdc);
  }

  /**
   * Build an unsigned withdraw XDR for the caller's wallet to sign. No step-up: same
   * reasoning as deposit. The withdraw XDR carries `user.require_auth()`, so it is
   * inert until the wallet signs that exact operation; a leaked access token alone
   * can build an XDR but never sign or submit a real withdrawal.
   */
  @Post('withdraw')
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
   * Managed Sessions (server + public lane). Enable builds the register_session XDR
   * authorizing the caller's server-held delegate as a bounded session key (total
   * spend cap + expiry; it pays any payee up to the cap); the wallet signs it and
   * submits via `submit`. Thereafter `session/pay` spends hands-off (the server signs
   * with the delegate, no per-payment signature), bounded on-chain. Pause, edit, and
   * revoke are wallet-signed.
   */
  @Post('session/enable')
  enableSession(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { spendCapUsdc, expiresInSeconds, ruleId } = parseBody(sessionEnableSchema, body);
    return this.vault.buildEnableSession(
      user.userId,
      spendCapUsdc,
      expiresInSeconds,
      ruleId ?? null,
    );
  }

  /** Hands-off public-lane spend; bounded by the on-chain session cap (no step-up). */
  @Post('session/pay')
  sessionPay(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { payee, amount, ruleId } = parseBody(sessionPayBodySchema, body);
    return this.vault.sessionPay(user.userId, payee, amount, ruleId ?? null);
  }

  /** Build the wallet-signed pause/unpause XDR for the caller's Managed Session key. */
  @Post('session/pause')
  pauseSession(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { paused } = parseBody(sessionPauseSchema, body);
    return this.vault.buildPauseSession(user.userId, paused);
  }

  /** Build the wallet-signed edit XDR (extend expiry / raise cap). 0 leaves a field. */
  @Post('session/update')
  updateSession(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { newExpiresInSeconds, newSpendCapUsdc } = parseBody(sessionUpdateSchema, body);
    return this.vault.buildUpdateSession(user.userId, newExpiresInSeconds, newSpendCapUsdc);
  }

  /** Build the wallet-signed revoke_session XDR; submit via `submit` to kill the key. */
  @Post('session/revoke')
  revokeSession(@CurrentUser() user: AuthUser) {
    return this.vault.buildRevokeSession(user.userId);
  }

  /** The caller's live managed-session scope (remaining budget, allowlist, expiry), or null. */
  @Get('session')
  getSession(@CurrentUser() user: AuthUser) {
    return this.vault.getSession(user.userId);
  }

  // ── Self-custody agent keys (local session keys) ─────────────────────────────

  /**
   * Build register_session for a SELF-CUSTODY agent key: the owner authorizes an
   * arbitrary public key (server_held=false) bound to a public rule + optional cap,
   * optionally time-boxed. Signed in the wallet and submitted via `submit`. The agent
   * holds the key's secret and spends with it directly (local mode).
   */
  @Post('agent-key/register')
  registerAgentKey(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parseBody(agentKeyRegisterSchema, body);
    return this.vault.buildRegisterAgentKey(
      user.userId,
      p.sessionPublicKey,
      p.ruleId,
      p.spendCapUsdc,
      p.expiresInSeconds,
    );
  }

  /** Build the wallet-signed pause/unpause XDR for a specific agent key. */
  @Post('agent-key/pause')
  pauseAgentKey(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parseBody(agentKeyPauseSchema, body);
    return this.vault.buildPauseAgentKey(user.userId, p.sessionPublicKey, p.paused);
  }

  /** Build the wallet-signed revoke_session XDR for a specific agent key. */
  @Post('agent-key/revoke')
  revokeAgentKey(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parseBody(agentKeyOnlySchema, body);
    return this.vault.buildRevokeAgentKey(user.userId, p.sessionPublicKey);
  }

  /** The live on-chain scope of a specific agent key (cap/spent/rule/paused/...), or null. */
  @Get('agent-key/:sessionPublicKey')
  agentKey(@CurrentUser() user: AuthUser, @Param('sessionPublicKey') sessionPublicKey: string) {
    return this.vault.getAgentKey(user.userId, sessionPublicKey);
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
   * pp/2 KEYLESS release (the plan's Sovereign private path). The caller proved
   * their private rule client-side and POSTs the proof + payouts; the vault's
   * release_proved_keyless takes NO require_auth, so the proof + the user's pinned
   * commitment + a fresh nullifier authorize it. The API submits it via a fee-payer
   * relayer that holds no power over funds and never sees the rule. No delegate, no
   * per-user registration, no per-payment signature. Synchronous: returns the real
   * tx hash. When a global-private is set, `global` carries the required 2nd proof.
   */
  @Post('batch-release-keyless')
  async batchReleaseKeyless(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const req = parseBody(batchReleaseKeylessSchema, body);
    if (req.payees.length !== req.amounts.length || req.payees.length !== req.nullifiers.length) {
      throw new BadRequestException('payees, amounts, and nullifiers must be equal length');
    }
    if (req.global && req.global.nullifiers.length !== req.payees.length) {
      throw new BadRequestException('global nullifiers must match the payee count');
    }
    const toProof = (p: { a: string; b: string; c: string }) => ({
      a: Buffer.from(p.a, 'hex'),
      b: Buffer.from(p.b, 'hex'),
      c: Buffer.from(p.c, 'hex'),
    });
    return this.vault.releaseKeyless(user.userId, {
      commitmentHex: req.commitment,
      payees: req.payees,
      amountsStroops: req.amounts.map((a) => BigInt(a)),
      nullifiers: req.nullifiers.map((n) => Buffer.from(n, 'hex')),
      validAfter: BigInt(req.validAfter),
      validBefore: BigInt(req.validBefore),
      resetR2: req.resetR2,
      resetR7: req.resetR7,
      proof: toProof(req.proof),
      global: req.global
        ? {
            commitmentHex: req.global.commitment,
            nullifiers: req.global.nullifiers.map((n) => Buffer.from(n, 'hex')),
            resetR2: req.global.resetR2,
            resetR7: req.global.resetR7,
            proof: toProof(req.global.proof),
          }
        : null,
    });
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
