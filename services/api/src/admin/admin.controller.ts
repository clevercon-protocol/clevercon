import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Role } from '@clevercon/db';
import { AdminService } from './admin.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { parseBody } from '../auth/validate.js';

const listQuery = z.object({
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const roleSchema = z.object({
  role: z.nativeEnum(Role),
  grant: z.boolean(),
});

const feeSchema = z.object({
  bps: z.number().int().min(0).max(10000),
  recipient: z.string().min(1).optional(),
});

const moderateSchema = z.object({ active: z.boolean() });

const resolveSchema = z.object({
  resolution: z.string().min(1).max(1000),
  refundToUser: z.number().nonnegative().optional(),
  payoutToProvider: z.number().nonnegative().optional(),
  reject: z.boolean().optional(),
});

const disputeQuery = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']).optional(),
});

/** Operator console API. Every route requires the ADMIN role. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('activation')
  activation() {
    return this.admin.activation();
  }

  @Get('users')
  users(@Query() query: unknown) {
    const { limit, offset } = parseBody(listQuery, query);
    return this.admin.listUsers(limit, offset);
  }

  @Post('users/:id/roles')
  setRole(@Param('id') id: string, @Body() body: unknown) {
    const { role, grant } = parseBody(roleSchema, body);
    return this.admin.setUserRole(id, role, grant);
  }

  /** All services, for moderation. */
  @Get('services')
  services(@Query() query: unknown) {
    const { limit, offset } = parseBody(listQuery, query);
    return this.admin.listServices(limit, offset);
  }

  /** Take down or restore any service (operator moderation). */
  @Post('services/:id/moderate')
  moderate(@Param('id') id: string, @Body() body: unknown) {
    const { active } = parseBody(moderateSchema, body);
    return this.admin.moderateService(id, active);
  }

  /** Dispute queue (optionally filter by status). */
  @Get('disputes')
  disputes(@Query() query: unknown) {
    const { status } = parseBody(disputeQuery, query);
    return this.admin.listDisputes(status);
  }

  /** Resolve or reject an open dispute. */
  @Post('disputes/:id/resolve')
  resolveDispute(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.resolveDispute(id, parseBody(resolveSchema, body));
  }

  /** Current protocol fee + accrued fees. */
  @Get('fees')
  fees() {
    return this.admin.fees();
  }

  /** Set the protocol fee (bps) and optional recipient. */
  @Post('fees')
  setFee(@Body() body: unknown) {
    const { bps, recipient } = parseBody(feeSchema, body);
    return this.admin.setFee(bps, recipient);
  }
}
