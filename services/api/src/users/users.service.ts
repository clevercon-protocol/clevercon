import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { verificationEmail } from '../mail/templates.js';

/** Hash a verification code before storing it (never keep the plaintext at rest). */
const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async getMe(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: true, roles: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return {
      id: u.id,
      roles: u.roles.map((r) => r.role),
      wallets: u.wallets.map((w) => ({ address: w.address, isPrimary: w.isPrimary })),
      // The email state, so the dapp can show "verified" / "verify" without a second call.
      email: u.email,
      emailVerified: u.emailVerified,
      emailDelivery: this.mailer.enabled,
      createdAt: u.createdAt,
    };
  }

  /**
   * Set (or change) the user's notification email and send a 6-digit verification code.
   * The address is stored UNVERIFIED and receives no notifications until verified, so a
   * typo never leaks mail. When email delivery is not configured, the address is still
   * saved but cannot be verified (and nothing is sent).
   */
  async setEmail(userId: string, email: string) {
    const normalized = email.trim().toLowerCase();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: normalized,
        emailVerified: false,
        emailVerifiedAt: null,
        emailVerifyCode: hashCode(code),
        emailVerifyExpires: new Date(Date.now() + 15 * 60_000),
      },
    });
    let sent = false;
    if (this.mailer.enabled) {
      const msg = verificationEmail(code);
      sent = await this.mailer.send({ to: normalized, ...msg });
    }
    return { email: normalized, verificationSent: sent, emailDelivery: this.mailer.enabled };
  }

  /** Confirm the user's email with the code sent to it. */
  async verifyEmail(userId: string, code: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifyCode: true, emailVerifyExpires: true },
    });
    if (!u?.emailVerifyCode || !u.emailVerifyExpires) {
      throw new BadRequestException('No pending verification. Set your email first.');
    }
    if (u.emailVerifyExpires.getTime() < Date.now()) {
      throw new BadRequestException('The code has expired. Request a new one.');
    }
    if (hashCode(code.trim()) !== u.emailVerifyCode) {
      throw new BadRequestException('That code is not correct.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerifyCode: null,
        emailVerifyExpires: null,
      },
    });
    return { ok: true, verified: true };
  }

  /** Remove the email and stop all email notifications for this user. */
  async removeEmail(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: null,
        emailVerified: false,
        emailVerifiedAt: null,
        emailVerifyCode: null,
        emailVerifyExpires: null,
      },
    });
    return { ok: true };
  }
}
