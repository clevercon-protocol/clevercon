import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProviderService } from './provider.service.js';
import { ProviderController } from './provider.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
