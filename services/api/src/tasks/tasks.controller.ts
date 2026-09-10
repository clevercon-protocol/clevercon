import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TaskMode, TaskStatus } from '@clevercon/db';
import { TasksService } from './tasks.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
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
  policyId: z.string().optional(),
  description: z.string().max(2000).optional(),
});

/** The current session's tasks (buyer-scoped). */
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.tasks.create(user.userId, parseBody(createSchema, body));
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.tasks.listForUser(user.userId, parseBody(listQuery, query));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.getForUser(user.userId, id);
  }
}
