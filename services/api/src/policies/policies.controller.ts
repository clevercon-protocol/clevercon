import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PoliciesService } from './policies.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const createSchema = z.object({
  isPrivate: z.boolean().default(false),
  rules: z.object({
    perPaymentCeilingUsdc: z.number().positive().optional(),
    rollingCapUsdc: z.number().positive().optional(),
    rollingWindowSecs: z.number().int().positive().optional(),
    allowlist: z.array(z.string().min(1)).max(100).optional(),
    denylist: z.array(z.string().min(1)).max(100).optional(),
    denylistThresholdUsdc: z.number().positive().optional(),
  }),
});

/** The current session's spending policies. */
@Controller('policies')
@UseGuards(JwtAuthGuard)
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
}
