import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsGateway } from './events.gateway.js';

@Module({
  imports: [AuthModule], // provides JwtService for handshake auth
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
