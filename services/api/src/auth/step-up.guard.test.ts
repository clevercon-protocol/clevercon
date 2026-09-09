import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { StepUpGuard } from './step-up.guard.js';
import type { AuthService } from './auth.service.js';
import type { AuthUser, HttpRequest } from './types.js';

function ctx(headers: HttpRequest['headers'], user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, user }) }),
  } as unknown as ExecutionContext;
}

const user: AuthUser = { userId: 'u1', roles: [] };

describe('StepUpGuard', () => {
  it('rejects when the x-stepup header is missing', async () => {
    const auth = { verifyStepUp: vi.fn() } as unknown as AuthService;
    const guard = new StepUpGuard(auth);
    await expect(guard.canActivate(ctx({}, user))).rejects.toThrow(/step-up/i);
    expect(auth.verifyStepUp).not.toHaveBeenCalled();
  });

  it('rejects when the request is unauthenticated', async () => {
    const auth = { verifyStepUp: vi.fn() } as unknown as AuthService;
    const guard = new StepUpGuard(auth);
    await expect(guard.canActivate(ctx({ 'x-stepup': 'xdr' }, undefined))).rejects.toThrow();
    expect(auth.verifyStepUp).not.toHaveBeenCalled();
  });

  it('verifies the signed xdr against the user and allows on success', async () => {
    const auth = {
      verifyStepUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthService;
    const guard = new StepUpGuard(auth);
    await expect(guard.canActivate(ctx({ 'x-stepup': 'signed-xdr' }, user))).resolves.toBe(true);
    expect(auth.verifyStepUp).toHaveBeenCalledWith('signed-xdr', 'u1');
  });

  it('propagates rejection when verification fails', async () => {
    const auth = {
      verifyStepUp: vi.fn().mockRejectedValue(new Error('bad')),
    } as unknown as AuthService;
    const guard = new StepUpGuard(auth);
    await expect(guard.canActivate(ctx({ 'x-stepup': 'signed-xdr' }, user))).rejects.toThrow();
  });
});
