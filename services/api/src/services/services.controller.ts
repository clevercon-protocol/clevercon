import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ServicesService } from './services.service.js';
import { parseBody } from '../auth/validate.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

// The buyer's answers to a service's usage requirements: { key: value }. A secret
// value (API key/token) is encrypted server-side; a non-secret value is stored plain.
const setupBody = z.object({ values: z.record(z.string().max(4000)) });

const listQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  capability: z.string().optional(),
  tier: z.enum(['T1', 'T2', 'T3']).optional(),
  // Manifest-v2 discovery axes: how the service is paid / how it interacts.
  paymentModel: z.enum(['escrow', 'x402', 'mpp-session', 'subscription']).optional(),
  interaction: z.enum(['sync', 'async', 'human', 'metered']).optional(),
  // Price ceiling (USDC per call) for budget-bounded discovery.
  maxPrice: z.coerce.number().positive().optional(),
  sort: z.enum(['trust', 'recent', 'rating', 'price_asc', 'price_desc']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/** Public marketplace read API. */
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.services.list(parseBody(listQuery, query));
  }

  /** Public protocol fee (bps) so the dapp can disclose the take rate. */
  @Get('fee')
  fee() {
    return this.services.platformFeeBps();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }

  /** The caller's setup status for a service's usage requirements (auth-only). */
  @Get(':id/setup')
  @UseGuards(ApiAuthGuard)
  getSetup(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.getSetup(user.userId, id);
  }

  /** Save the caller's answers to a service's usage requirements (auth-only). */
  @Post(':id/setup')
  @UseGuards(ApiAuthGuard)
  saveSetup(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { values } = parseBody(setupBody, body);
    return this.services.saveSetup(user.userId, id, values);
  }
}
