import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';

// Global so any domain module can enqueue jobs without re-importing.
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
