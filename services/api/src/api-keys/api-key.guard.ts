import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service.js';
import type { HttpRequest } from '../auth/types.js';

/** Authenticates programmatic requests via the `x-api-key` header. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    const header = req.headers['x-api-key'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw new UnauthorizedException('Missing API key');
    const identity = await this.apiKeys.verify(raw);
    if (!identity) throw new UnauthorizedException('Invalid API key');
    req.apiKey = identity;
    return true;
  }
}
