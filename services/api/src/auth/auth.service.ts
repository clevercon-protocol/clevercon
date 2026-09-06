import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StrKey, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { Role } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomToken, sha256 } from './crypto.util.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';

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
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
  ) {}

  /** Step 1: build a SEP-10 challenge transaction for the wallet to sign. */
  async createChallenge(
    address: string,
  ): Promise<{ transaction: string; networkPassphrase: string }> {
    if (!StrKey.isValidEd25519PublicKey(address))
      throw new BadRequestException('Invalid Stellar address');
    const transaction = WebAuth.buildChallengeTx(
      this.auth.serverKeypair,
      address,
      this.auth.homeDomain,
      300,
      this.auth.networkPassphrase,
      this.auth.webAuthDomain,
    );
    const txHash = TransactionBuilder.fromXDR(transaction, this.auth.networkPassphrase)
      .hash()
      .toString('hex');
    await this.prisma.authChallenge.create({
      data: { address, nonce: txHash, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { transaction, networkPassphrase: this.auth.networkPassphrase };
  }

  /** Step 2: verify the signed challenge (SEP-10), upsert the user, issue tokens. */
  async verifyChallenge(signedXdr: string, meta?: SessionMeta): Promise<TokenBundle> {
    const serverId = this.auth.serverKeypair.publicKey();
    let clientAccountID: string;
    try {
      const read = WebAuth.readChallengeTx(
        signedXdr,
        serverId,
        this.auth.networkPassphrase,
        this.auth.homeDomain,
        this.auth.webAuthDomain,
      );
      clientAccountID = read.clientAccountID;
      WebAuth.verifyChallengeTxSigners(
        signedXdr,
        serverId,
        this.auth.networkPassphrase,
        [clientAccountID],
        this.auth.homeDomain,
        this.auth.webAuthDomain,
      );
    } catch {
      throw new UnauthorizedException('Invalid challenge signature');
    }

    // Replay protection: the tx hash is stable across signing; match a stored,
    // unconsumed, unexpired challenge and consume it.
    const txHash = TransactionBuilder.fromXDR(signedXdr, this.auth.networkPassphrase)
      .hash()
      .toString('hex');
    const challenge = await this.prisma.authChallenge.findUnique({ where: { nonce: txHash } });
    if (!challenge || challenge.address !== clientAccountID)
      throw new UnauthorizedException('Unknown challenge');
    if (challenge.consumedAt) throw new UnauthorizedException('Challenge already used');
    if (challenge.expiresAt < new Date()) throw new UnauthorizedException('Challenge expired');
    await this.prisma.authChallenge.update({
      where: { nonce: txHash },
      data: { consumedAt: new Date() },
    });

    const wallet = await this.prisma.wallet.upsert({
      where: { address: clientAccountID },
      update: {},
      create: { address: clientAccountID, isPrimary: true, user: { create: {} } },
      include: { user: { include: { roles: true } } },
    });

    let roles = wallet.user.roles.map((r) => r.role);
    if (roles.length === 0) {
      await this.prisma.userRole.create({ data: { userId: wallet.userId, role: Role.BUYER } });
      roles = [Role.BUYER];
    }
    return this.issueTokens(wallet.userId, roles, meta);
  }

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
