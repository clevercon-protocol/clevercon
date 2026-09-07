import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ServicesService } from './services.service.js';
import { parseBody } from '../auth/validate.js';

const listQuery = z.object({
  category: z.string().optional(),
  capability: z.string().optional(),
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

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }
}
