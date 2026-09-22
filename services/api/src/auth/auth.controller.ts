import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { parseBody } from './validate.js';
import type { HttpRequest } from './types.js';

const challengeSchema = z.object({ address: z.string() });
const verifySchema = z.object({ transaction: z.string() });
const refreshSchema = z.object({ refreshToken: z.string() });

function metaOf(req: HttpRequest) {
  const ua = req.headers['user-agent'];
  return { userAgent: Array.isArray(ua) ? ua[0] : ua, ip: req.ip };
}

// Auth is the most abused surface (credential stuffing, token brute force), so
// it gets a much tighter budget than the global default: 15 requests/minute per
// client IP across all of these endpoints.
@Throttle({ default: { ttl: seconds(60), limit: 15 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Request a sign-in challenge (nonce + message to sign). */
  @Post('challenge')
  challenge(@Body() body: unknown) {
    const { address } = parseBody(challengeSchema, body);
    return this.auth.createChallenge(address);
  }

  /** Verify the signed challenge transaction and receive access + refresh tokens. */
  @Post('verify')
  verify(@Body() body: unknown, @Req() req: HttpRequest) {
    const { transaction } = parseBody(verifySchema, body);
    return this.auth.verifyChallenge(transaction, metaOf(req));
  }

  /** Rotate tokens using a valid refresh token. */
  @Post('refresh')
  refresh(@Body() body: unknown, @Req() req: HttpRequest) {
    const { refreshToken } = parseBody(refreshSchema, body);
    return this.auth.refresh(refreshToken, metaOf(req));
  }

  /** Revoke a refresh token (logout). */
  @Post('logout')
  logout(@Body() body: unknown) {
    const { refreshToken } = parseBody(refreshSchema, body);
    return this.auth.logout(refreshToken);
  }
}
