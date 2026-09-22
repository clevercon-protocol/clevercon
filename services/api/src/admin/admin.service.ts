import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PaymentStatus, Role, ServiceStatus } from '@clevercon/db';
import type { AppEnv } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultContractService } from '../vault/vault-contract.service.js';

/** Operator-facing platform data. All methods are ADMIN-gated at the controller. */
@Injectable()
export class AdminService {
  private readonly usdcSac: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
    @Optional() private readonly vault?: VaultContractService,
  ) {
    this.usdcSac = config.get('USDC_SAC', { infer: true }) ?? '';
  }

  /** Current protocol fee + claimable accrued fees (from the vault contract). */
  async fees() {
    if (!this.vault?.feeAdminEnabled) {
      return { enabled: false, bps: 0, recipient: null, accruedUsdc: 0 };
    }
    const [fee, accruedUsdc] = await Promise.all([
      this.vault.getFee(),
      this.vault.getAccruedFeesUsdc(),
    ]);
    return { enabled: true, bps: fee.bps, recipient: fee.recipient, accruedUsdc };
  }

  /** Set the protocol fee on the vault (admin). */
  async setFee(bps: number, recipient?: string) {
    if (!this.vault?.feeAdminEnabled) {
      throw new BadRequestException('Fee administration is not configured');
    }
    const txHash = await this.vault.setFee(bps, recipient);
    return { txHash, ...(await this.fees()) };
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

  /**
   * Activation funnel: how many users have reached each step of the core path
   * (connected, funded, set a policy, created a key, created a task, made a
   * bounded payment). First-party and aggregate, computed from data we already
   * hold (no external analytics, no PII). "Funded" is based on indexed on-chain
   * vault balances, so it reflects what the indexer has observed.
   */
  async activation() {
    const [total, policyUsers, keyUsers, taskUsers, fundedAccounts, paidPayments] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.policy.findMany({ distinct: ['userId'], select: { userId: true } }),
        this.prisma.apiKey.findMany({ distinct: ['userId'], select: { userId: true } }),
        this.prisma.task.findMany({ distinct: ['buyerId'], select: { buyerId: true } }),
        this.prisma.vaultAccount.findMany({
          where: { balance: { gt: 0 } },
          select: { address: true },
        }),
        this.prisma.payment.findMany({
          where: { status: PaymentStatus.CONFIRMED },
          select: { taskId: true },
        }),
      ]);

    // Funded users: wallets whose address has an indexed vault balance > 0.
    const fundedAddrs = fundedAccounts.map((a) => a.address);
    const fundedWallets = fundedAddrs.length
      ? await this.prisma.wallet.findMany({
          where: { address: { in: fundedAddrs } },
          distinct: ['userId'],
          select: { userId: true },
        })
      : [];

    // Paid users: buyers of the tasks that have a confirmed payment.
    const paidTaskIds = [...new Set(paidPayments.map((p) => p.taskId).filter(Boolean) as string[])];
    const paidTasks = paidTaskIds.length
      ? await this.prisma.task.findMany({
          where: { id: { in: paidTaskIds } },
          distinct: ['buyerId'],
          select: { buyerId: true },
        })
      : [];

    const steps = [
      { key: 'connected', label: 'Connected a wallet', count: total },
      { key: 'funded', label: 'Funded a vault', count: fundedWallets.length },
      { key: 'policy', label: 'Set a spending policy', count: policyUsers.length },
      { key: 'agent', label: 'Created an API key', count: keyUsers.length },
      { key: 'hired', label: 'Created a task', count: taskUsers.length },
      { key: 'paid', label: 'Made a bounded payment', count: paidTasks.length },
    ];
    return { total, steps };
  }

  /** All services (any owner) for moderation, newest first. */
  async listServices(limit = 50, offset = 0) {
    const take = Math.min(limit, 100);
    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({
        orderBy: { registeredAt: 'desc' },
        take,
        skip: offset,
        include: { reputation: { select: { score: true, totalJobs: true } } },
      }),
      this.prisma.service.count(),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        name: s.name,
        category: s.category,
        status: s.status,
        pricePerCall: Number(s.pricePerCall),
        score: s.reputation?.score ?? 0,
        totalJobs: s.reputation?.totalJobs ?? 0,
      })),
      total,
      limit: take,
      offset,
    };
  }

  /**
   * Moderate any service (operator takedown / restore), independent of its
   * owner: ACTIVE is listed in the marketplace, INACTIVE is hidden. Does not
   * delete it, so history and reputation are preserved.
   */
  async moderateService(serviceId: string, active: boolean) {
    const status = active ? ServiceStatus.ACTIVE : ServiceStatus.INACTIVE;
    try {
      const s = await this.prisma.service.update({ where: { id: serviceId }, data: { status } });
      return { id: s.id, status: s.status };
    } catch {
      throw new NotFoundException('Service not found');
    }
  }

  /** Disputes for the operator queue, newest first (optionally by status). */
  async listDisputes(status?: 'OPEN' | 'RESOLVED' | 'REJECTED') {
    const rows = await this.prisma.dispute.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { task: { select: { title: true, budget: true, buyerId: true } } },
    });
    return {
      items: rows.map((d) => ({
        id: d.id,
        taskId: d.taskId,
        taskTitle: d.task.title,
        budget: Number(d.task.budget),
        raisedBy: d.raisedBy,
        status: d.status,
        reason: d.reason,
        resolution: d.resolution,
        refundToUser: d.refundToUser != null ? Number(d.refundToUser) : null,
        payoutToProvider: d.payoutToProvider != null ? Number(d.payoutToProvider) : null,
        createdAt: d.createdAt,
        resolvedAt: d.resolvedAt,
      })),
      total: rows.length,
    };
  }

  /**
   * Resolve an open dispute (operator/arbiter). Either reject it (no split) or
   * record a split of the task's value between a refund to the buyer and a
   * payout to the provider. DB is the record of the arbiter's decision; the
   * on-chain split (vault resolve_dispute on a locked task) is a follow-up that
   * needs the configured dispute-resolver key.
   */
  async resolveDispute(
    disputeId: string,
    params: {
      resolution: string;
      refundToUser?: number;
      payoutToProvider?: number;
      reject?: boolean;
    },
  ) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status !== 'OPEN') {
      throw new BadRequestException('Dispute is already resolved');
    }
    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: params.reject ? 'REJECTED' : 'RESOLVED',
        resolution: params.resolution,
        refundToUser: params.reject ? null : (params.refundToUser ?? null),
        payoutToProvider: params.reject ? null : (params.payoutToProvider ?? null),
        resolvedAt: new Date(),
      },
    });
    return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt };
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
