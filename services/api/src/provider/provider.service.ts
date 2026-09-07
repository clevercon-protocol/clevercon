import { Injectable } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

const ZERO = new Prisma.Decimal(0);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type ServiceWithRep = Prisma.ServiceGetPayload<{ include: { reputation: true } }>;

function serializeService(s: ServiceWithRep) {
  return {
    id: s.id,
    agentId: s.agentId,
    name: s.name,
    category: s.category,
    pricePerCall: Number(s.pricePerCall),
    currency: s.currency,
    status: s.status,
    reputation: s.reputation
      ? { score: s.reputation.score, totalJobs: s.reputation.totalJobs }
      : null,
  };
}

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Services owned by the current provider. */
  async listServices(userId: string) {
    const rows = await this.prisma.service.findMany({
      where: { providerId: userId },
      include: { reputation: true },
      orderBy: { registeredAt: 'desc' },
    });
    return { items: rows.map(serializeService), total: rows.length };
  }

  /**
   * Earnings + recent incoming jobs for the current provider. Earnings are the
   * confirmed payments sent to any of the provider's service addresses.
   */
  async earnings(userId: string) {
    const services = await this.prisma.service.findMany({
      where: { providerId: userId },
      include: { reputation: true },
    });
    const addresses = services.map((s) => s.stellarAddress);
    const byAddress = new Map(services.map((s) => [s.stellarAddress, s.name]));

    if (addresses.length === 0) {
      return { totalEarned: 0, thisWeek: 0, jobs: 0, rating: 0, recent: [] };
    }

    const payments = await this.prisma.payment.findMany({
      where: { toAddress: { in: addresses } },
      orderBy: { createdAt: 'desc' },
    });

    const weekAgo = Date.now() - WEEK_MS;
    let total = ZERO;
    let week = ZERO;
    let jobs = 0;
    for (const p of payments) {
      if (p.status !== PaymentStatus.CONFIRMED) continue;
      total = total.add(p.amount);
      jobs += 1;
      if (p.createdAt.getTime() >= weekAgo) week = week.add(p.amount);
    }

    const rated = services.filter((s) => s.reputation && s.reputation.totalJobs > 0);
    const rating = rated.length
      ? rated.reduce((acc, s) => acc + (s.reputation?.score ?? 0), 0) / rated.length
      : 0;

    return {
      totalEarned: Number(total),
      thisWeek: Number(week),
      jobs,
      rating: Math.round(rating * 10) / 10,
      recent: payments.slice(0, 10).map((p) => ({
        id: p.id,
        service: byAddress.get(p.toAddress) ?? p.toAddress,
        from: p.fromAddress,
        amount: Number(p.amount),
        status: p.status,
        createdAt: p.createdAt,
      })),
    };
  }
}
