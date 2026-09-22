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

/** Result of verifying+metering a key: authenticated, unknown, or over quota. */
export type ApiKeyVerifyResult =
  | { ok: true; identity: ApiKeyIdentity }
  | { ok: false; reason: 'invalid' | 'quota' };

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a key. The full secret is returned once and never stored. Creating a
   * key also grants the caller the DEVELOPER role (self-serve API access), done
   * atomically with the key so the two can never diverge.
   */
  async create(userId: string, name: string, scopes: string[] = [], quotaPerDay = 0) {
    const { key, prefix, secret } = generateApiKey();
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { userId, name, prefix, keyHash: sha256(secret), scopes, quotaPerDay },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId, role: Role.DEVELOPER } },
        create: { userId, role: Role.DEVELOPER },
        update: {},
      });
      return created;
    });
    return { id: record.id, name, prefix, scopes, quotaPerDay, key };
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
        quotaPerDay: true,
        usageToday: true,
        usageDay: true,
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

  /**
   * Verify a raw key and meter its usage. Returns the identity, or a reason it
   * was refused ('invalid' for unknown/revoked/expired/bad-secret, 'quota' when
   * the key is over its daily cap). On success, stamps lastUsedAt, increments
   * the lifetime counter, and advances the daily window; over quota no counters
   * move so the rejected call is not billed.
   */
  async verify(rawKey: unknown): Promise<ApiKeyVerifyResult> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return { ok: false, reason: 'invalid' };
    const record = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    if (!record || record.revokedAt) return { ok: false, reason: 'invalid' };
    if (record.expiresAt && record.expiresAt < new Date()) return { ok: false, reason: 'invalid' };
    if (!safeEqualHex(sha256(parsed.secret), record.keyHash))
      return { ok: false, reason: 'invalid' };

    const today = utcDay();
    const usedToday = record.usageDay === today ? record.usageToday : 0;
    if (record.quotaPerDay > 0 && usedToday >= record.quotaPerDay) {
      return { ok: false, reason: 'quota' };
    }

    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: {
        lastUsedAt: new Date(),
        requestCount: { increment: 1 },
        usageDay: today,
        usageToday: usedToday + 1,
      },
    });
    return {
      ok: true,
      identity: { apiKeyId: record.id, userId: record.userId, scopes: record.scopes },
    };
  }
}
