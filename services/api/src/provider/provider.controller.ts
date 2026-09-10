import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PricingModel } from '@clevercon/db';
import { ProviderService } from './provider.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  category: z.string().max(120).optional(),
  capabilities: z.array(z.string().max(60)).max(20).optional(),
  pricingModel: z.nativeEnum(PricingModel),
  pricePerCall: z.number().nonnegative(),
  endpoint: z.string().url(),
  stellarAddress: z.string().min(1).max(120),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(2000).optional(),
    category: z.string().max(120).optional(),
    capabilities: z.array(z.string().max(60)).max(20).optional(),
    pricePerCall: z.number().nonnegative().optional(),
    endpoint: z.string().url().optional(),
    stellarAddress: z.string().min(1).max(120).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

const statusSchema = z.object({ active: z.boolean() });

/** Provider-scoped views: the caller's own services and earnings. */
@Controller('provider')
@UseGuards(JwtAuthGuard)
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  /** Register a service (self-serve); grants the caller the PROVIDER role. */
  @Post('services')
  register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.provider.registerService(user.userId, parseBody(registerSchema, body));
  }

  @Get('services')
  services(@CurrentUser() user: AuthUser) {
    return this.provider.listServices(user.userId);
  }

  /** Edit a service the caller owns. */
  @Patch('services/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.provider.updateService(user.userId, id, parseBody(updateSchema, body));
  }

  /** Pause or resume a service the caller owns. */
  @Post('services/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { active } = parseBody(statusSchema, body);
    return this.provider.setServiceStatus(user.userId, id, active);
  }

  /** Task steps routed to the caller's services (real incoming work). */
  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.provider.jobs(user.userId);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.provider.earnings(user.userId);
  }
}
