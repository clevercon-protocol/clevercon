import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Role } from '@clevercon/db';
import { DisputesService } from './disputes.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const openSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

const respondSchema = z.object({ response: z.string().min(1).max(2000) });

const resolveSchema = z.object({
  refundToUser: z.number().nonnegative(),
  payoutToProvider: z.number().nonnegative(),
  upheld: z.boolean(),
  resolution: z.string().max(2000).optional(),
});

/** The buyer's disputes: open one (freezes the task on-chain) and track them. */
@Controller('disputes')
@UseGuards(ApiAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * Open a dispute on a locked task. Returns the unsigned `raise_dispute` XDR;
   * sign it and POST it to /vault/submit to freeze the task on-chain.
   */
  @Post()
  open(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { taskId, reason } = parseBody(openSchema, body);
    return this.disputes.open(user.userId, taskId, reason);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.disputes.list(user.userId);
  }

  /** The provider's dispute inbox: disputes on tasks that use their services. */
  @Get('provider')
  forProvider(@CurrentUser() user: AuthUser) {
    return this.disputes.listForProvider(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.get(user.userId, id);
  }

  /** A provider on the disputed task posts their reply/evidence. */
  @Post(':id/respond')
  respond(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { response } = parseBody(respondSchema, body);
    return this.disputes.respond(user.userId, id, response);
  }

  /** Arbiter (admin) settles the dispute on-chain and records the outcome. */
  @Post(':id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  resolve(@Param('id') id: string, @Body() body: unknown) {
    return this.disputes.resolve(id, parseBody(resolveSchema, body));
  }
}
