import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [AuthModule, VaultModule], // JwtAuthGuard + vault lock-on-hire
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
