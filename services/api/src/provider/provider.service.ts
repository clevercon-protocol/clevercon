import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus, PricingModel, Role, ServiceStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

const ZERO = new Prisma.Decimal(0);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface RegisterServiceParams {
  name: string;
  description: string;
  category?: string;
  capabilities?: string[];
  pricingModel: PricingModel;
  pricePerCall: number;
  endpoint: string;
  stellarAddress: string;
}

/** Fields a provider may edit after registration. All optional (partial update). */
export interface UpdateServiceParams {
  name?: string;
  description?: string;
  category?: string;
  capabilities?: string[];
  pricePerCall?: number;
  endpoint?: string;
  stellarAddress?: string;
}

/** Stable, URL-safe id from a display name plus a short random suffix. */
function toAgentId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'service';
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

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

  /**
   * Register a service under the current user and grant them the PROVIDER role,
   * atomically (self-serve onboarding, mirrors API-key -> DEVELOPER). The
   * service goes live immediately with a fresh (zeroed) reputation row.
   */
  async registerService(userId: string, params: RegisterServiceParams) {
    const created = await this.prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          providerId: userId,
          agentId: toAgentId(params.name),
          name: params.name,
          description: params.description,
          category: params.category,
          capabilities: params.capabilities ?? [],
          pricingModel: params.pricingModel,
          pricePerCall: new Prisma.Decimal(params.pricePerCall),
          endpoint: params.endpoint,
          stellarAddress: params.stellarAddress,
          status: ServiceStatus.ACTIVE,
          reputation: { create: {} },
        },
        include: { reputation: true },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId, role: Role.PROVIDER } },
        create: { userId, role: Role.PROVIDER },
        update: {},
      });
      return service;
    });
    return serializeService(created);
  }

  /**
   * Edit a service the caller owns. Ownership is enforced in the WHERE clause
   * (id + providerId), so a provider can never mutate another provider's
   * service. Only the provided fields change.
   */
  async updateService(userId: string, serviceId: string, params: UpdateServiceParams) {
    const data: Prisma.ServiceUpdateInput = {};
    if (params.name !== undefined) data.name = params.name;
    if (params.description !== undefined) data.description = params.description;
    if (params.category !== undefined) data.category = params.category;
    if (params.capabilities !== undefined) data.capabilities = params.capabilities;
    if (params.pricePerCall !== undefined)
      data.pricePerCall = new Prisma.Decimal(params.pricePerCall);
    if (params.endpoint !== undefined) data.endpoint = params.endpoint;
    if (params.stellarAddress !== undefined) data.stellarAddress = params.stellarAddress;

    const result = await this.prisma.service.updateMany({
      where: { id: serviceId, providerId: userId },
      data,
    });
    if (result.count === 0) throw new NotFoundException('Service not found');

    const updated = await this.prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      include: { reputation: true },
    });
    return serializeService(updated);
  }

  /**
   * Pause (INACTIVE) or resume (ACTIVE) a service the caller owns. A paused
   * service drops out of the public marketplace (which lists only ACTIVE/NEW)
   * but is not deleted, so reputation and history are preserved.
   */
  async setServiceStatus(userId: string, serviceId: string, active: boolean) {
    const status = active ? ServiceStatus.ACTIVE : ServiceStatus.INACTIVE;
    const result = await this.prisma.service.updateMany({
      where: { id: serviceId, providerId: userId },
      data: { status },
    });
    if (result.count === 0) throw new NotFoundException('Service not found');

    const updated = await this.prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      include: { reputation: true },
    });
    return serializeService(updated);
  }

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
