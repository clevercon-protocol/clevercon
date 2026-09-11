import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
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
    const result = await this.apiKeys.verify(raw);
    if (!result.ok) {
      if (result.reason === 'quota') {
        throw new HttpException('Daily API quota exceeded', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException('Invalid API key');
    }
    req.apiKey = result.identity;
    return true;
  }
}
