import { Module } from '@nestjs/common';
import { ServicesService } from './services.service.js';
import { ServicesController } from './services.controller.js';

@Module({
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
