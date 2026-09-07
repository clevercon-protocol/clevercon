import { Controller, Get, UseGuards } from '@nestjs/common';
import { ProviderService } from './provider.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/types.js';

/** Provider-scoped views: the caller's own services and earnings. */
@Controller('provider')
@UseGuards(JwtAuthGuard)
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  @Get('services')
  services(@CurrentUser() user: AuthUser) {
    return this.provider.listServices(user.userId);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.provider.earnings(user.userId);
  }
}
