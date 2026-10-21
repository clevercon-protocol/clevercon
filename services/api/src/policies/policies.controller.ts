import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PoliciesService } from './policies.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const createSchema = z.object({
  isPrivate: z.boolean().default(false),
  name: z.string().min(1).max(100).optional(),
  form: z.enum(['private', 'public']).optional(),
  global: z.boolean().optional(),
  supersedes: z.string().min(1).optional(),
  rules: z.object({
    perPaymentCeilingUsdc: z.number().positive().optional(),
    rollingCapUsdc: z.number().positive().optional(),
    rollingWindowSecs: z.number().int().positive().optional(),
    allowlist: z.array(z.string().min(1)).max(100).optional(),
    denylist: z.array(z.string().min(1)).max(100).optional(),
    denylistThresholdUsdc: z.number().positive().optional(),
  }),
});

const proofSchema = z.object({
  payeeAddress: z.string().min(1),
  amountUsdc: z.number().positive(),
});

/** The current session's spending policies. */
@Controller('policies')
@UseGuards(ApiAuthGuard)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.policies.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.policies.create(user.userId, parseBody(createSchema, body));
  }

  /** Archive a policy (hidden from pickers, kept for audit). */
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.policies.archive(user.userId, id);
  }

  /** Request a binding proof for a release (payee + amount) under this policy. */
  @Post(':id/proofs')
  requestProof(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { payeeAddress, amountUsdc } = parseBody(proofSchema, body);
    return this.policies.requestProof(user.userId, id, payeeAddress, amountUsdc);
  }

  /** Poll a proof's status. */
  @Get('proofs/:proofId')
  getProof(@CurrentUser() user: AuthUser, @Param('proofId') proofId: string) {
    return this.policies.getProof(user.userId, proofId);
  }
}
