import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { StepUpGuard } from './step-up.guard.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import type { AppEnv } from '../config/env.validation.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    StepUpGuard,
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): AuthConfig => {
        const secret = config.get('SERVER_SIGNING_KEY', { infer: true });
        if (!secret) {
          // eslint-disable-next-line no-console
          console.warn(
            '[auth] SERVER_SIGNING_KEY not set; using an ephemeral signing key (dev only)',
          );
        }
        return {
          serverKeypair: secret ? Keypair.fromSecret(secret) : Keypair.random(),
          networkPassphrase: config.get('NETWORK_PASSPHRASE', { infer: true }),
          homeDomain: config.get('HOME_DOMAIN', { infer: true }),
          webAuthDomain: config.get('WEB_AUTH_DOMAIN', { infer: true }),
        };
      },
    },
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, StepUpGuard, JwtModule],
})
export class AuthModule {}
