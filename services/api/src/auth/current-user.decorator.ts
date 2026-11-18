import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, HttpRequest } from './types.js';

/** Injects the authenticated user (set by JwtAuthGuard) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<HttpRequest>().user,
);
