import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.provider.earnings(user.userId);
  }
}
