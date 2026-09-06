/** Deterministic demo data for backendless mode (no API/wallet needed). */

export interface DemoService {
  id: string;
  name: string;
  category: string;
  description: string;
  pricePerCall: number;
  rating: number;
  provider: string;
}

export const demoVault = {
  balanceUsdc: 250,
  lockedUsdc: 40,
  availableUsdc: 210,
};

export const demoCategories = [
  'Data & Oracles',
  'AI & Analysis',
  'Web & Research',
  'Finance & DeFi',
  'Risk & Compliance',
  'Human Services',
  'Business Services',
];

export interface DemoDispute {
  id: string;
  task: string;
  parties: string;
  amountUsdc: number;
  status: 'open' | 'resolved';
}

export const demoPlatform = { users: 128, activeServices: 24, feeBps: 30, tvlUsdc: 9840 };

export const demoDisputes: DemoDispute[] = [
  {
    id: 'd-204',
    task: 'Risk brief on wallet X',
    parties: 'GBUY…4K2 vs Risk Screen',
    amountUsdc: 25,
    status: 'open',
  },
  {
    id: 'd-198',
    task: 'Tokenomics report',
    parties: 'GA7M…H3D vs Reporter',
    amountUsdc: 12,
    status: 'resolved',
  },
];

export interface DemoApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsed: string;
  created: string;
}

export const demoUsage = { callsToday: 1240, callsWeek: 8930, keys: 3 };

export const demoApiKeys: DemoApiKey[] = [
  { id: 'k-1', name: 'prod-agent', prefix: 'cc_A1b2C3', lastUsed: '3m ago', created: '2026-08-20' },
  { id: 'k-2', name: 'ci', prefix: 'cc_D4e5F6', lastUsed: '2h ago', created: '2026-08-22' },
  { id: 'k-3', name: 'local-dev', prefix: 'cc_G7h8I9', lastUsed: '1d ago', created: '2026-09-01' },
];

export interface DemoJob {
  id: string;
  service: string;
  buyer: string;
  amountUsdc: number;
  status: 'pending' | 'completed' | 'disputed';
  when: string;
}

export const demoEarnings = {
  totalUsdc: 1284.5,
  thisWeekUsdc: 96.2,
  jobs: 143,
  rating: 4.6,
};

export const demoJobs: DemoJob[] = [
  {
    id: 'j-1042',
    service: 'Stellar Oracle',
    buyer: 'GBUY…4K2',
    amountUsdc: 0.05,
    status: 'completed',
    when: '2m ago',
  },
  {
    id: 'j-1041',
    service: 'Web Intel',
    buyer: 'GXR9…7QP',
    amountUsdc: 0.1,
    status: 'pending',
    when: '11m ago',
  },
  {
    id: 'j-1039',
    service: 'Analysis',
    buyer: 'GA7M…H3D',
    amountUsdc: 0.15,
    status: 'completed',
    when: '38m ago',
  },
  {
    id: 'j-1036',
    service: 'Reporter',
    buyer: 'GDQC…AM2',
    amountUsdc: 0.12,
    status: 'disputed',
    when: '1h ago',
  },
];

export const demoServices: DemoService[] = [
  {
    id: 'stellar-oracle',
    name: 'Stellar Oracle',
    category: 'Data & Oracles',
    description: 'Live Stellar price and network data.',
    pricePerCall: 0.05,
    rating: 4.7,
    provider: 'AI agent',
  },
  {
    id: 'web-intel',
    name: 'Web Intel',
    category: 'Web & Research',
    description: 'Web research and summarisation.',
    pricePerCall: 0.1,
    rating: 4.5,
    provider: 'AI agent',
  },
  {
    id: 'risk-screen',
    name: 'Risk Screen',
    category: 'Risk & Compliance',
    description: 'Wallet and counterparty risk scoring.',
    pricePerCall: 0.25,
    rating: 4.8,
    provider: 'Business',
  },
  {
    id: 'analysis',
    name: 'Analysis',
    category: 'AI & Analysis',
    description: 'Synthesis and reasoning over inputs.',
    pricePerCall: 0.15,
    rating: 4.4,
    provider: 'AI agent',
  },
  {
    id: 'reporter',
    name: 'Reporter',
    category: 'Business Services',
    description: 'Turns findings into a clean report.',
    pricePerCall: 0.12,
    rating: 4.6,
    provider: 'AI agent',
  },
  {
    id: 'defi-quotes',
    name: 'DeFi Quotes',
    category: 'Finance & DeFi',
    description: 'Best-path swap and pool quotes.',
    pricePerCall: 0.08,
    rating: 4.3,
    provider: 'AI agent',
  },
];
