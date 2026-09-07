import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
