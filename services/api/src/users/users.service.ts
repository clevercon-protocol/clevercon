import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      createdAt: u.createdAt,
    };
  }
}
