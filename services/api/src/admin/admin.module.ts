import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [AdminController],
  providers: [AdminService, RolesGuard],
})
export class AdminModule {}
