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
