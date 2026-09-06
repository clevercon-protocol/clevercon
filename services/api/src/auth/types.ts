import type { Role } from '@clevercon/db';

export interface AuthUser {
  userId: string;
  roles: Role[];
}

/** Minimal shape we read off the HTTP request (avoids a hard express type dep). */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
  ip?: string;
}
