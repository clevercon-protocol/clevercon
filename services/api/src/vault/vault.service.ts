import { Injectable } from '@nestjs/common';
import { Prisma } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

const ZERO = new Prisma.Decimal(0);

function n(d: Prisma.Decimal): number {
  return Number(d);
}

@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate the vault position for a user across every wallet they control.
   * On-chain is the source of truth; these rows are the indexed mirror, so a
   * user with no deposits yet simply reads back zeros.
   */
  async getForUser(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { address: true },
    });
    const addresses = wallets.map((w) => w.address);
    if (addresses.length === 0) {
      return {
        balance: 0,
        available: 0,
        locked: 0,
        totalDeposited: 0,
        totalSpent: 0,
        accounts: [],
      };
    }

    const rows = await this.prisma.vaultAccount.findMany({
      where: { address: { in: addresses } },
      orderBy: { balance: 'desc' },
    });

    let balance = ZERO;
    let locked = ZERO;
    let totalDeposited = ZERO;
    let totalSpent = ZERO;
    for (const r of rows) {
      balance = balance.add(r.balance);
      locked = locked.add(r.locked);
      totalDeposited = totalDeposited.add(r.totalDeposited);
      totalSpent = totalSpent.add(r.totalSpent);
    }

    return {
      balance: n(balance),
      available: n(balance.sub(locked)),
      locked: n(locked),
      totalDeposited: n(totalDeposited),
      totalSpent: n(totalSpent),
      accounts: rows.map((r) => ({
        address: r.address,
        asset: r.asset,
        balance: n(r.balance),
        available: n(r.balance.sub(r.locked)),
        locked: n(r.locked),
        activeTasks: r.activeTasks,
      })),
    };
  }
}
