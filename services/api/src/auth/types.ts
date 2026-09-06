import type { Role } from '@clevercon/db';

export interface AuthUser {
  userId: string;
  roles: Role[];
}

export interface ApiKeyIdentity {
  apiKeyId: string;
  userId: string;
  scopes: string[];
}

/** Minimal shape we read off the HTTP request (avoids a hard express type dep). */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
  apiKey?: ApiKeyIdentity;
  ip?: string;
}
