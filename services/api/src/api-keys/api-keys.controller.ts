import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyService } from './api-key.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const createSchema = z.object({ name: z.string().min(1), scopes: z.array(z.string()).optional() });

/** Developer API-key management. Requires a logged-in user (wallet session). */
@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  /** Create a key; the full secret is returned exactly once. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { name, scopes } = parseBody(createSchema, body);
    return this.apiKeys.create(user.userId, name, scopes ?? []);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(user.userId);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiKeys.revoke(user.userId, id);
  }
}
