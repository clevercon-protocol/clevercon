import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PoliciesService } from './policies.service.js';
import { PoliciesController } from './policies.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
