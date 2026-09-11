import { Injectable } from '@nestjs/common';
import { Role } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeEqualHex, sha256 } from '../auth/crypto.util.js';
import { generateApiKey, parseApiKey } from './api-key.util.js';

export interface ApiKeyIdentity {
  apiKeyId: string;
  userId: string;
  scopes: string[];
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a key. The full secret is returned once and never stored. Creating a
   * key also grants the caller the DEVELOPER role (self-serve API access), done
   * atomically with the key so the two can never diverge.
   */
  async create(userId: string, name: string, scopes: string[] = []) {
    const { key, prefix, secret } = generateApiKey();
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { userId, name, prefix, keyHash: sha256(secret), scopes },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId, role: Role.DEVELOPER } },
        create: { userId, role: Role.DEVELOPER },
        update: {},
      });
      return created;
    });
    return { id: record.id, name, prefix, scopes, key };
  }

  async list(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        requestCount: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Verify a raw key; returns the identity or null. Bumps lastUsedAt on success. */
  async verify(rawKey: unknown): Promise<ApiKeyIdentity | null> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return null;
    const record = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    if (!safeEqualHex(sha256(parsed.secret), record.keyHash)) return null;
    // Meter usage: stamp last-used and increment the call counter atomically.
    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
    return { apiKeyId: record.id, userId: record.userId, scopes: record.scopes };
  }
}
