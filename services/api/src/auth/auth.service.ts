import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateNonce, randomToken, sha256 } from './crypto.util.js';
import {
  buildChallengeMessage,
  isValidStellarAddress,
  verifyStellarSignature,
} from './signature.util.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  roles: Role[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Step 1: issue a nonce + message for the wallet to sign. */
  async createChallenge(address: string): Promise<{ message: string; nonce: string }> {
    if (!isValidStellarAddress(address)) throw new BadRequestException('Invalid Stellar address');
    const nonce = generateNonce();
    await this.prisma.authChallenge.create({
      data: { address, nonce, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { message: buildChallengeMessage(address, nonce), nonce };
  }

  /** Step 2: verify the signature, upsert the user, and issue tokens. */
  async verifyChallenge(
    address: string,
    nonce: string,
    signature: string,
    meta?: SessionMeta,
  ): Promise<TokenBundle> {
    const challenge = await this.prisma.authChallenge.findUnique({ where: { nonce } });
    if (!challenge || challenge.address !== address)
      throw new UnauthorizedException('Unknown challenge');
    if (challenge.consumedAt) throw new UnauthorizedException('Challenge already used');
    if (challenge.expiresAt < new Date()) throw new UnauthorizedException('Challenge expired');

    const message = buildChallengeMessage(address, nonce);
    if (!verifyStellarSignature(address, message, signature)) {
      throw new UnauthorizedException('Signature verification failed');
    }
    await this.prisma.authChallenge.update({ where: { nonce }, data: { consumedAt: new Date() } });

    const wallet = await this.prisma.wallet.upsert({
      where: { address },
      update: {},
      create: { address, isPrimary: true, user: { create: {} } },
      include: { user: { include: { roles: true } } },
    });

    let roles = wallet.user.roles.map((r) => r.role);
    if (roles.length === 0) {
      await this.prisma.userRole.create({ data: { userId: wallet.userId, role: Role.BUYER } });
      roles = [Role.BUYER];
    }
    return this.issueTokens(wallet.userId, roles, meta);
  }

  /** Rotate a refresh token: revoke the old session, mint a new pair. */
  async refresh(refreshToken: string, meta?: SessionMeta): Promise<TokenBundle> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: { include: { roles: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(
      session.userId,
      session.user.roles.map((r) => r.role),
      meta,
    );
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  private async issueTokens(
    userId: string,
    roles: Role[],
    meta?: SessionMeta,
  ): Promise<TokenBundle> {
    const accessToken = await this.jwt.signAsync({ sub: userId, roles });
    const refreshToken = randomToken();
    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        userAgent: meta?.userAgent,
        ip: meta?.ip,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { accessToken, refreshToken, roles };
  }
}
