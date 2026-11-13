import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { OAuthService } from './oauth.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const authorizeBody = z.object({
  serviceId: z.string().min(1),
  key: z.string().min(1).max(60).optional(),
});

/** GitHub OAuth broker: connect a scoped, revocable token via GitHub's consent screen. */
@Controller('oauth/github')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** Whether the "Connect GitHub" option is available (client id + secret configured). */
  @Get('status')
  status() {
    return { configured: this.oauth.isConfigured() };
  }

  /** Mint the GitHub authorize URL for the caller to redirect the browser to. */
  @Post('authorize-url')
  @UseGuards(JwtAuthGuard)
  authorizeUrl(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { serviceId, key } = parseBody(authorizeBody, body);
    return { url: this.oauth.authorizeUrl(user.userId, serviceId, key ?? 'github_token') };
  }

  /** GitHub redirects here with the code; we exchange, store, and return to the dapp. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleCallback(code, state);
    res.redirect(url);
  }
}
