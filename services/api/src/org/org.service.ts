import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

interface OrgInput {
  name: string;
  handle: string;
  bio?: string;
  links?: Record<string, string>;
}
interface ProfileInput {
  displayName?: string;
  handle?: string;
  bio?: string;
  links?: Record<string, string>;
}

/** A compact service card for a profile page. */
function serviceCard(s: {
  id: string;
  name: string;
  category: string | null;
  tier: string;
  pricePerCall: Prisma.Decimal;
  status: string;
}) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    tier: s.tier,
    pricePerCall: Number(s.pricePerCall),
    status: s.status,
  };
}

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** A handle must be unique across BOTH users and orgs (one profile namespace). */
  private async ensureHandleFree(handle: string, self?: { orgId?: string; userId?: string }) {
    if (!HANDLE_RE.test(handle)) {
      throw new BadRequestException(
        'Handle must be 2-39 chars: lowercase letters, numbers, or hyphens.',
      );
    }
    const org = await this.prisma.organization.findUnique({ where: { handle } });
    if (org && org.id !== self?.orgId) throw new BadRequestException('That handle is taken.');
    const user = await this.prisma.user.findUnique({ where: { handle } });
    if (user && user.id !== self?.userId) throw new BadRequestException('That handle is taken.');
  }

  async createOrg(userId: string, input: OrgInput) {
    const handle = input.handle.toLowerCase();
    await this.ensureHandleFree(handle);
    const org = await this.prisma.organization.create({
      data: {
        name: input.name,
        handle,
        bio: input.bio,
        links: (input.links ?? undefined) as Prisma.InputJsonValue | undefined,
        createdById: userId,
        members: { create: { userId, role: 'admin' } },
      },
    });
    return { id: org.id, handle: org.handle, name: org.name, verified: org.verified };
  }

  async updateOrg(userId: string, orgId: string, patch: Partial<OrgInput>) {
    if (!(await this.isMember(userId, orgId))) throw new ForbiddenException('Not an org member.');
    const data: Prisma.OrganizationUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.bio !== undefined) data.bio = patch.bio;
    if (patch.links !== undefined) data.links = patch.links as Prisma.InputJsonValue;
    if (patch.handle !== undefined) {
      const handle = patch.handle.toLowerCase();
      await this.ensureHandleFree(handle, { orgId });
      data.handle = handle;
    }
    const org = await this.prisma.organization.update({ where: { id: orgId }, data });
    return { id: org.id, handle: org.handle, name: org.name, verified: org.verified };
  }

  /** Orgs the user may list services under (they are a member of). */
  async myOrgs(userId: string) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { org: true },
      orderBy: { org: { name: 'asc' } },
    });
    return rows.map((m) => ({
      id: m.org.id,
      handle: m.org.handle,
      name: m.org.name,
      verified: m.org.verified,
      role: m.role,
    }));
  }

  async isMember(userId: string, orgId: string): Promise<boolean> {
    const m = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    return !!m;
  }

  /** The caller's own profile + the orgs they belong to (for the console). */
  async myProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return {
      displayName: user.displayName,
      handle: user.handle,
      bio: user.bio,
      links: user.links ?? null,
      verified: user.verified,
      orgs: await this.myOrgs(userId),
    };
  }

  async updateMyProfile(userId: string, patch: ProfileInput) {
    const data: Prisma.UserUpdateInput = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.bio !== undefined) data.bio = patch.bio;
    if (patch.links !== undefined) data.links = patch.links as Prisma.InputJsonValue;
    if (patch.handle !== undefined) {
      const handle = patch.handle.toLowerCase();
      await this.ensureHandleFree(handle, { userId });
      data.handle = handle;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.myProfile(userId);
  }

  /** A public profile by handle: an org or an individual provider, plus their services. */
  async publicProfile(handleRaw: string) {
    const handle = handleRaw.toLowerCase();
    const cardSelect = {
      id: true,
      name: true,
      category: true,
      tier: true,
      pricePerCall: true,
      status: true,
    } as const;

    const org = await this.prisma.organization.findUnique({
      where: { handle },
      include: {
        services: { where: { status: 'ACTIVE' }, select: cardSelect, orderBy: { name: 'asc' } },
      },
    });
    if (org) {
      return {
        type: 'org' as const,
        handle: org.handle,
        name: org.name,
        bio: org.bio,
        links: org.links ?? null,
        verified: org.verified,
        services: org.services.map(serviceCard),
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { handle },
      include: {
        services: {
          where: { status: 'ACTIVE', ownerOrgId: null },
          select: cardSelect,
          orderBy: { name: 'asc' },
        },
      },
    });
    if (user) {
      return {
        type: 'user' as const,
        handle: user.handle,
        name: user.displayName || `@${user.handle}`,
        bio: user.bio,
        links: user.links ?? null,
        verified: user.verified,
        services: user.services.map(serviceCard),
      };
    }
    throw new NotFoundException('No profile with that handle');
  }
}
