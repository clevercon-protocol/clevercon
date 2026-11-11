import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrgService } from './org.service.js';
import { OrgController } from './org.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService], // ProviderModule validates org membership at registration
})
export class OrgModule {}
