import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
