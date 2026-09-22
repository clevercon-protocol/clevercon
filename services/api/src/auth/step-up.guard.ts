import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { HttpRequest } from './types.js';

/**
 * Gate a sensitive (money) action on a fresh wallet signature, in addition to
 * the access token. The client obtains a normal SEP-10 challenge for its wallet,
 * signs it, and sends the signed XDR in the `x-stepup` header. This proves live
 * wallet control at the moment of the action, so a leaked access token alone
 * cannot initiate it.
 *
 * Must run after JwtAuthGuard (which populates req.user); apply it at the method
 * level on controllers whose class is already JWT-guarded.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    if (!req.user) throw new UnauthorizedException('Authentication required');
    const header = req.headers['x-stepup'];
    const signedXdr = Array.isArray(header) ? header[0] : header;
    if (!signedXdr) throw new UnauthorizedException('Step-up signature required for this action');
    await this.auth.verifyStepUp(signedXdr, req.user.userId);
    return true;
  }
}
