import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TasksService } from '../tasks/tasks.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const lineSchema = z.object({
  payee: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
});

const paySchema = z.object({
  kind: z.enum(['pay', 'disburse']),
  lines: z.array(lineSchema).min(1).max(100),
  policyId: z.string().optional(),
  title: z.string().max(200).optional(),
});

/**
 * The direct spend primitive: pay one address or disburse to many, each bounded
 * by a policy and released from the vault via the proof-gated path. Works with a
 * JWT (the dApp) or an x-api-key (agents/SDK), so the same primitive powers all
 * three doors.
 */
@Controller('payments')
@UseGuards(ApiAuthGuard)
export class PaymentsController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.tasks.createPayment(user.userId, parseBody(paySchema, body));
  }
}
