import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ServicesService } from './services.service.js';
import { parseBody } from '../auth/validate.js';

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
}
