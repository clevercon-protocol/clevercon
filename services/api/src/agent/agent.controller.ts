import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AgentService } from './agent.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const planSchema = z.object({ instruction: z.string().min(1).max(2000) });

/**
 * The chat agent's brain: parse a natural-language instruction into a structured
 * spending plan. It only PROPOSES; the human approves and the vault enforces the
 * limits, so nothing here can move funds on its own. Works with a JWT or a key.
 */
@Controller('agent')
@UseGuards(ApiAuthGuard)
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('plan')
  plan(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { instruction } = parseBody(planSchema, body);
    return this.agent.plan(user.userId, instruction);
  }
}
