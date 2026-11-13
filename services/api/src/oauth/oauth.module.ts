import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ServicesModule } from '../services/services.module.js';
import { OAuthService } from './oauth.service.js';
import { OAuthController } from './oauth.controller.js';

@Module({
  // AuthModule: JwtAuthGuard + JwtService (to sign/verify the OAuth state).
  // ServicesModule: saveSetup, to store the brokered token against the service setup.
  imports: [AuthModule, ServicesModule],
  controllers: [OAuthController],
  providers: [OAuthService],
})
export class OAuthModule {}
