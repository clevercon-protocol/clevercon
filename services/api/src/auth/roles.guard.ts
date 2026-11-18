import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@clevercon/db';
import { ROLES_KEY } from './roles.decorator.js';
import { hasRequiredRoles } from './rbac.js';
import type { HttpRequest } from './types.js';

/** Enforces @Roles(...) metadata. Use after JwtAuthGuard so req.user is set. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    if (!hasRequiredRoles(req.user?.roles ?? [], required)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
