import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PaymentStatus, Role, ServiceStatus } from '@clevercon/db';
import type { AppEnv } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Operator-facing platform data. All methods are ADMIN-gated at the controller. */
@Injectable()
export class AdminService {
  private readonly usdcSac: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.usdcSac = config.get('USDC_SAC', { infer: true }) ?? '';
  }

  /** Real platform metrics, read from the DB mirror (no fabricated numbers). */
  async stats() {
    const [users, activeServices, totalServices, tasks, confirmed] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.service.count({
        where: { status: { in: [ServiceStatus.ACTIVE, ServiceStatus.NEW] } },
      }),
      this.prisma.service.count(),
      this.prisma.task.count(),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.CONFIRMED },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Total value locked = summed vault balances for the configured USDC asset.
    const tvl = await this.prisma.vaultAccount.aggregate({
      where: this.usdcSac ? { asset: this.usdcSac } : {},
      _sum: { balance: true, locked: true },
    });

    return {
      users,
      activeServices,
      totalServices,
      tasks,
      paymentsCount: confirmed._count,
      paymentsVolumeUsdc: Number(confirmed._sum.amount ?? new Prisma.Decimal(0)),
      tvlUsdc: Number(tvl._sum.balance ?? new Prisma.Decimal(0)),
      lockedUsdc: Number(tvl._sum.locked ?? new Prisma.Decimal(0)),
    };
  }

  /** Paginated user list with roles, wallet, and role-relevant counts. */
  async listUsers(limit = 25, offset = 0) {
    const take = Math.min(limit, 100);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        skip: offset,
        include: {
          roles: true,
          wallets: { where: { isPrimary: true }, take: 1 },
          _count: { select: { services: true, tasks: true, apiKeys: true } },
        },
      }),
      this.prisma.user.count(),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        createdAt: u.createdAt,
        roles: u.roles.map((r) => r.role),
        wallet: u.wallets[0]?.address ?? null,
        services: u._count.services,
        tasks: u._count.tasks,
        apiKeys: u._count.apiKeys,
      })),
      total,
      limit: take,
      offset,
    };
  }

  /**
   * Grant or revoke a role for a user (operator action). Idempotent. ADMIN is
   * grantable only by an existing admin (the route is ADMIN-gated); we refuse to
   * remove the last admin so the platform can never lock itself out.
   */
  async setUserRole(userId: string, role: Role, grant: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!grant && role === Role.ADMIN) {
      const admins = await this.prisma.userRole.count({ where: { role: Role.ADMIN } });
      if (admins <= 1) {
        throw new BadRequestException('Cannot remove the last admin');
      }
    }

    if (grant) {
      await this.prisma.userRole.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
      });
    } else {
      await this.prisma.userRole.deleteMany({ where: { userId, role } });
    }
    const roles = await this.prisma.userRole.findMany({ where: { userId } });
    return { userId, roles: roles.map((r) => r.role) };
  }
}
