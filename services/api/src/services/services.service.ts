import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ServiceStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

type ServiceWithRep = Prisma.ServiceGetPayload<{ include: { reputation: true } }>;

export interface ListParams {
  category?: string;
  capability?: string;
  limit?: number;
  offset?: number;
}

function serialize(s: ServiceWithRep) {
  return {
    id: s.id,
    agentId: s.agentId,
    name: s.name,
    description: s.description,
    category: s.category,
    capabilities: s.capabilities,
    pricingModel: s.pricingModel,
    pricePerCall: Number(s.pricePerCall),
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    reputation: s.reputation
      ? {
          score: s.reputation.score,
          totalJobs: s.reputation.totalJobs,
          avgLatencyMs: s.reputation.avgLatencyMs,
        }
      : null,
  };
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListParams) {
    const where: Prisma.ServiceWhereInput = {
      status: { in: [ServiceStatus.ACTIVE, ServiceStatus.NEW] },
    };
    if (params.category) where.category = params.category;
    if (params.capability) where.capabilities = { has: params.capability };

    const take = Math.min(params.limit ?? 50, 100);
    const skip = params.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        include: { reputation: true },
        orderBy: { registeredAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.service.count({ where }),
    ]);
    return { items: rows.map(serialize), total, limit: take, offset: skip };
  }

  async get(id: string) {
    const s = await this.prisma.service.findUnique({
      where: { id },
      include: { reputation: true },
    });
    if (!s) throw new NotFoundException('Service not found');
    return serialize(s);
  }
}
