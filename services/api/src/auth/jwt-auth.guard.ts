import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@clevercon/db';
import type { HttpRequest } from './types.js';

interface AccessTokenPayload {
  sub: string;
  roles: Role[];
}

/** Validates the Bearer access token and attaches `req.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
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
