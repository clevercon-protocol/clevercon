import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ServiceStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

type ServiceWithRep = Prisma.ServiceGetPayload<{ include: { reputation: true } }>;

export type ServiceSort = 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface ListParams {
  q?: string;
  category?: string;
  capability?: string;
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

// Map the public sort keys to Prisma orderBy. Every service carries a (zeroed)
// reputation row, so ordering by the relation is well-defined.
const SORT_ORDER: Record<ServiceSort, Prisma.ServiceOrderByWithRelationInput> = {
  recent: { registeredAt: 'desc' },
  rating: { reputation: { score: 'desc' } },
  price_asc: { pricePerCall: 'asc' },
  price_desc: { pricePerCall: 'desc' },
};

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
    // Server-side search so it composes correctly with pagination.
    if (params.q)
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
      ];

    const take = Math.min(params.limit ?? 50, 100);
    const skip = params.offset ?? 0;
    const orderBy = SORT_ORDER[params.sort ?? 'recent'];
    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({ where, include: { reputation: true }, orderBy, take, skip }),
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
