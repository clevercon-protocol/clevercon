/**
 * Local dev seed. Gives a fresh clone real data to look at with zero keys or
 * testnet setup, so any contributor can run the app immediately in demo mode.
 * Idempotent: safe to run repeatedly.
 */
import 'dotenv/config';
import { PrismaClient, Role, PricingModel, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // A demo buyer+provider user with a wallet.
  const user = await prisma.user.upsert({
    where: { id: 'demo-user' },
    update: {},
    create: {
      id: 'demo-user',
      wallets: {
        create: {
          address: 'GDEMO0000000000000000000000000000000000000000000000000000',
          isPrimary: true,
        },
      },
      roles: { create: [{ role: Role.BUYER }, { role: Role.PROVIDER }] },
    },
  });

  // A couple of sample services so the marketplace isn't empty in demo mode.
  const services = [
    {
      agentId: 'stellar-oracle',
      name: 'Stellar Market Oracle',
      description: 'Live Stellar network stats and XLM/USDC spot price from Horizon.',
      category: 'Data & Oracles',
      capabilities: ['price', 'orderbook', 'network'],
      pricingModel: PricingModel.X402,
      pricePerCall: '0.05',
      // The real reference provider (services/reference-provider) runs here.
      endpoint: 'http://localhost:4200',
      stellarAddress: 'GORACLE000000000000000000000000000000000000000000000000000',
    },
    {
      agentId: 'web-intel',
      name: 'Web Intel',
      description: 'Web research and summarisation.',
      category: 'Web & Research',
      capabilities: ['search', 'scrape', 'summarise'],
      pricingModel: PricingModel.X402,
      pricePerCall: '0.10',
      endpoint: 'http://localhost:4002',
      stellarAddress: 'GWEBINTEL0000000000000000000000000000000000000000000000000',
    },
  ];

  for (const s of services) {
    await prisma.service.upsert({
      where: { agentId: s.agentId },
      update: {},
      create: {
        ...s,
        providerId: user.id,
        status: ServiceStatus.ACTIVE,
        reputation: {
          create: {
            score: 4.6,
            totalJobs: 12,
            successfulJobs: 11,
            failedJobs: 1,
            avgQuality: 4.5,
            avgLatencyMs: 800,
          },
        },
      },
    });
  }

  console.log('Seed complete: demo user + sample services.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
