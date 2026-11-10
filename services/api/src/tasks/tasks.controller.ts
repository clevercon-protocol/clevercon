import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TaskMode, TaskStatus } from '@clevercon/db';
import { TasksService } from './tasks.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const listQuery = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  mode: z.nativeEnum(TaskMode),
  budget: z.number().positive(),
  serviceId: z.string().optional(),
  // Which function of a multi-function service to hire (its key).
  functionKey: z.string().max(60).optional(),
  policyId: z.string().optional(),
  description: z.string().max(2000).optional(),
  // Structured job input for the provider (validated against the service's
  // inputSchema by the worker); may carry an attachment ArtifactRef.
  input: z.record(z.unknown()).optional(),
  // Also accepted in the body for clients that cannot set a header.
  idempotencyKey: z.string().min(1).max(255).optional(),
});

const disputeSchema = z.object({ reason: z.string().max(1000).optional() });

// Answer a needs-input step. The response object is validated against the
// provider's question schema (if any) server-side before it is relayed.
const answerSchema = z.object({ response: z.record(z.unknown()) });

/** The current session's tasks (buyer-scoped). Works with a JWT (console) or an
 *  x-api-key (programmatic/SDK), so developers can hire + query on the rail. */
@Controller('tasks')
@UseGuards(ApiAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const parsed = parseBody(createSchema, body);
    const idempotencyKey = headerKey?.trim().slice(0, 255) || parsed.idempotencyKey || undefined;
    return this.tasks.create(user.userId, { ...parsed, idempotencyKey });
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.tasks.listForUser(user.userId, parseBody(listQuery, query));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.getForUser(user.userId, id);
  }

  /** Raise a dispute on one of the caller's tasks. */
  @Post(':id/dispute')
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parseBody(disputeSchema, body);
    return this.tasks.raiseDispute(user.userId, id, reason);
  }

  /** Approve a task's held (T2) steps early, releasing before the dispute window ends. */
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.approve(user.userId, id);
  }

  /** Answer a step a provider parked as INPUT_REQUIRED (an elicitation), resuming it. */
  @Post(':id/steps/:stepId/answer')
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: unknown,
  ) {
    const { response } = parseBody(answerSchema, body);
    return this.tasks.answerStep(user.userId, id, stepId, response);
  }
}
