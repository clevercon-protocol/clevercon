import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiKeyService } from '../api-keys/api-key.service.js';
import type { HttpRequest } from './types.js';

interface AccessTokenPayload {
  sub: string;
  roles: Role[];
}

/**
 * Authenticates a request via EITHER a Bearer JWT (the console) OR an `x-api-key`
 * header (programmatic / SDK use), attaching the same `req.user` so downstream
 * code is identical. This is what lets developers drive the rail with a key
 * exactly as the UI does with a session. API-key requests have their usage
 * metered (see ApiKeyService.verify).
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly apiKeys: ApiKeyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HttpRequest>();

    const apiKeyHeader = req.headers['x-api-key'];
    const rawKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (rawKey) {
      const identity = await this.apiKeys.verify(rawKey);
      if (!identity) throw new UnauthorizedException('Invalid API key');
      const roles = await this.prisma.userRole.findMany({ where: { userId: identity.userId } });
      req.apiKey = identity;
      req.user = { userId: identity.userId, roles: roles.map((r) => r.role) };
      return true;
    }

    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token or API key');
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(value.slice(7));
      req.user = { userId: payload.sub, roles: payload.roles ?? [] };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
