import type { Role } from '@clevercon/db';

/**
 * Access predicate: a user passes if no roles are required, or they hold at
 * least one of the required roles. Pure and unit-tested; the RolesGuard is a
 * thin wrapper over this.
 */
export function hasRequiredRoles(userRoles: Role[], required: Role[]): boolean {
  if (required.length === 0) return true;
  return required.some((r) => userRoles.includes(r));
}
