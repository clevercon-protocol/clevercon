import 'dotenv/config';
import { PrismaClient } from '@clevercon/db';
import { recoverOrphanLocks } from './settlement.js';

/**
 * One-off recovery for stranded batch-disburse locks. A pp/2 disburse locks an
 * on-chain task to reserve its budget; before the finalize-on-settle fix, those
 * locks were never freed, so funds could sit `locked` forever. This finds a user's
 * orphan locked tasks on-chain and completes them, returning the budget.
 *
 * Run where DELEGATE_ENCRYPTION_KEY + the vault env are set (i.e. Railway):
 *   npm run recover -w @clevercon/workers -- <G...address | userId>
 */
async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npm run recover -w @clevercon/workers -- <G...address | userId>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    let userId = arg;
    if (/^G[A-Z2-7]{55}$/.test(arg)) {
      const wallet = await prisma.wallet.findFirst({ where: { address: arg } });
      if (!wallet) {
        console.error('No user found for address', arg);
        process.exit(1);
      }
      userId = wallet.userId;
    }
    console.log('Recovering orphan locked tasks for user', userId, '...');
    const res = await recoverOrphanLocks(prisma, userId);
    console.log(
      `Done. Unlocked ${res.unlocked.length} task(s): ${res.unlocked.join(', ') || '(none)'}. Skipped ${res.skipped}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('recover failed:', e);
  process.exit(1);
});
