import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AppEnv } from '../config/env.validation.js';
import { ServicesService } from '../services/services.service.js';

const GH_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';
// Minimal scope: read + write to PUBLIC repos (issues, PRs, comments). Enough for the
// open-source use case and a far smaller grant than a full PAT.
const GH_SCOPE = 'public_repo';

interface StatePayload {
  sub: string; // userId
  serviceId: string;
  key: string; // the requirement key to store the token under
  purpose: 'gh-oauth';
}

/**
 * Brokers GitHub OAuth so a buyer connects via GitHub's own consent screen instead of
 * pasting a personal access token. The resulting scoped, revocable token is stored
 * encrypted against the service setup and passed to the provider at job time, never to
 * the model. The client secret stays on the server; the browser only ever sees GitHub.
 */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);
  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly jwt: JwtService,
    private readonly services: ServicesService,
  ) {}

  private clientId() {
    return this.config.get('GITHUB_OAUTH_CLIENT_ID', { infer: true });
  }
  private clientSecret() {
    return this.config.get('GITHUB_OAUTH_CLIENT_SECRET', { infer: true });
  }
  isConfigured(): boolean {
    return !!this.clientId() && !!this.clientSecret();
  }

  /** The API's public base, for the redirect_uri GitHub calls back. */
  private apiBase(): string {
    const explicit = this.config.get('API_PUBLIC_URL', { infer: true });
    if (explicit) return explicit.replace(/\/+$/, '');
    const railway = this.config.get('RAILWAY_PUBLIC_DOMAIN', { infer: true });
    if (railway) return `https://${railway}`;
    return 'http://localhost:4100';
  }

  /** Where to send the user back after connecting (the dapp). */
  private appBase(): string {
    const explicit = this.config.get('APP_PUBLIC_URL', { infer: true });
    if (explicit) return explicit.replace(/\/+$/, '');
    const cors = this.config.get('CORS_ORIGINS', { infer: true });
    const first = cors?.split(',')[0]?.trim();
    return (first || 'https://clevercon.xyz').replace(/\/+$/, '');
  }

  private redirectUri(): string {
    return `${this.apiBase()}/oauth/github/callback`;
  }

  /** Build the GitHub authorize URL with a signed, short-lived state. */
  authorizeUrl(userId: string, serviceId: string, key: string): string {
    if (!this.isConfigured()) {
      throw new BadRequestException('GitHub connect is not configured on this server.');
    }
    const state = this.jwt.sign(
      { sub: userId, serviceId, key, purpose: 'gh-oauth' } satisfies StatePayload,
      { expiresIn: '10m' },
    );
    const params = new URLSearchParams({
      client_id: this.clientId()!,
      redirect_uri: this.redirectUri(),
      scope: GH_SCOPE,
      state,
      allow_signup: 'false',
    });
    return `${GH_AUTHORIZE}?${params.toString()}`;
  }

  /**
   * Exchange the callback code for a token and store it against the service setup.
   * Returns the dapp URL to redirect the browser to (success or a flagged error).
   */
  async handleCallback(code?: string, state?: string): Promise<string> {
    const fail = (serviceId: string | null, reason: string) => {
      this.log.warn(`github oauth callback failed: ${reason}`);
      const base = serviceId ? `${this.appBase()}/app/marketplace/${serviceId}` : this.appBase();
      return `${base}?connected=0`;
    };
    if (!code || !state) return fail(null, 'missing code/state');

    let payload: StatePayload;
    try {
      payload = this.jwt.verify<StatePayload>(state);
      if (payload.purpose !== 'gh-oauth') throw new Error('bad purpose');
    } catch {
      return fail(null, 'invalid state');
    }

    let token: string | undefined;
    try {
      const res = await fetch(GH_TOKEN, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId(),
          client_secret: this.clientSecret(),
          code,
          redirect_uri: this.redirectUri(),
        }),
      });
      const json = (await res.json()) as { access_token?: string; error?: string };
      token = json.access_token;
      if (!token) return fail(payload.serviceId, json.error ?? 'no access_token');
    } catch (e) {
      return fail(payload.serviceId, `exchange error: ${(e as Error).message}`);
    }

    try {
      await this.services.saveSetup(payload.sub, payload.serviceId, { [payload.key]: token });
    } catch (e) {
      return fail(payload.serviceId, `store error: ${(e as Error).message}`);
    }
    return `${this.appBase()}/app/marketplace/${payload.serviceId}?connected=1`;
  }
}
