import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { ActivityService } from './activity.service.js';
import { ActivityController } from './activity.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule], // JWT (console) or x-api-key (agents)
  controllers: [ActivityController],
  providers: [ActivityService, ApiAuthGuard],
  exports: [ActivityService],
})
export class ActivityModule {}
