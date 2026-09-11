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
