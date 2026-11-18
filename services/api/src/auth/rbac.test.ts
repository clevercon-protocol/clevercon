import { describe, it, expect } from 'vitest';
import { Role } from '@clevercon/db';
import { hasRequiredRoles } from './rbac';

describe('hasRequiredRoles', () => {
  it('allows when nothing is required', () => {
    expect(hasRequiredRoles([], [])).toBe(true);
    expect(hasRequiredRoles([Role.BUYER], [])).toBe(true);
  });

  it('allows when the user has one of the required roles', () => {
    expect(hasRequiredRoles([Role.BUYER, Role.PROVIDER], [Role.PROVIDER])).toBe(true);
    expect(hasRequiredRoles([Role.ADMIN], [Role.ADMIN, Role.DEVELOPER])).toBe(true);
  });

  it('denies when the user lacks all required roles', () => {
    expect(hasRequiredRoles([Role.BUYER], [Role.ADMIN])).toBe(false);
    expect(hasRequiredRoles([], [Role.ADMIN])).toBe(false);
  });
});
