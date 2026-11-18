import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { StorageService } from './storage.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule], // ApiAuthGuard accepts JWT or x-api-key
  controllers: [UploadsController],
  providers: [StorageService, ApiAuthGuard],
  exports: [StorageService],
})
export class UploadsModule {}
