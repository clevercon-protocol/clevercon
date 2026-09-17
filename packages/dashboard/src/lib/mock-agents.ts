/**
 * Sample marketplace services, shown only when there is no live registry
 * backend connected. These are DEMO DATA, not real registered services: every
 * entry is marked `is_mock` and `inactive`. They illustrate the range of
 * services that can register on CleverCon: automated AI agents, human
 * specialists, and business services, across many categories.
 */

const PLACEHOLDER_ADDR = 'GANAFRW5CK3KGXJ6WLXJJFP3D2PI734OGYBHXJUKJQKEL4W2F5HLSEDZ';
const now = () => new Date().toISOString();

export type ProviderType = 'ai' | 'human' | 'business';

interface Seed {
  id: string;
  name: string;
  category: string;
  provider: ProviderType;
  model: 'x402' | 'mpp';
  price: number;
  description: string;
  capabilities: string[];
  score: number;
  jobs: number;
  quality: number;
  latency: number;
  fail?: number;
}

const SEEDS: Seed[] = [
  // ── Data & Oracles ──────────────────────────────────────────────────────────
  { id: 'stellar-oracle', name: 'StellarOracle', category: 'Data & Oracles', provider: 'ai', model: 'x402', price: 0.020,
    description: 'Live Stellar market data pulled straight from Horizon and the SDEX: asset prices, order books, spreads, path-payment quotes, and network stats. Returns clean JSON in a single call.',
    capabilities: ['prices', 'orderbooks', 'dex', 'network-stats'], score: 96, jobs: 1840, quality: 4.8, latency: 380 },
  { id: 'chain-metrics', name: 'ChainMetrics', category: 'Data & Oracles', provider: 'ai', model: 'x402', price: 0.030,
    description: 'On-chain analytics for Stellar DeFi: total value locked, 24h volume, active accounts, and per-protocol breakdowns across Blend, Aquarius, Soroswap, and DeFindex.',
    capabilities: ['analytics', 'tvl', 'volume', 'defi'], score: 91, jobs: 720, quality: 4.6, latency: 640 },
  { id: 'fx-rates', name: 'FX Rates', category: 'Data & Oracles', provider: 'ai', model: 'x402', price: 0.010,
    description: 'Real-time fiat and crypto exchange rates for 160+ currencies, with mid-market and volume-weighted quotes. Useful for pricing cross-border payments and stablecoin conversions.',
    capabilities: ['fx', 'exchange-rates', 'stablecoins'], score: 88, jobs: 2510, quality: 4.5, latency: 260 },

  // ── AI & Analysis ───────────────────────────────────────────────────────────
  { id: 'analysis-agent', name: 'AnalysisBot', category: 'AI & Analysis', provider: 'ai', model: 'mpp', price: 0.050,
    description: 'Deep LLM analysis and synthesis over a streaming payment channel. Feed it data and a question and it reasons across sources to produce a structured, cited answer.',
    capabilities: ['analysis', 'reasoning', 'synthesis'], score: 93, jobs: 980, quality: 4.7, latency: 5200 },
  { id: 'sentiment-ai', name: 'SentimentAI', category: 'AI & Analysis', provider: 'ai', model: 'x402', price: 0.025,
    description: 'Market and social sentiment scoring for a given asset or topic, aggregated from news, forums, and social feeds, with a rolling 24h trend and confidence score.',
    capabilities: ['sentiment', 'nlp', 'social'], score: 82, jobs: 640, quality: 4.2, latency: 1400 },
  { id: 'summarizer-ai', name: 'Summarizer', category: 'AI & Analysis', provider: 'ai', model: 'x402', price: 0.015,
    description: 'Condenses long documents, threads, or transcripts into a tight brief with key points and action items. Handles up to 100k tokens per call.',
    capabilities: ['summarization', 'nlp'], score: 86, jobs: 1520, quality: 4.4, latency: 2100 },
  { id: 'translator-ai', name: 'Translator', category: 'AI & Analysis', provider: 'ai', model: 'x402', price: 0.012,
    description: 'Machine translation across 50+ languages with tone and glossary control. Fast and cheap for everyday content; pair with the human Certified Translation service for legal documents.',
    capabilities: ['translation', 'nlp'], score: 84, jobs: 1980, quality: 4.1, latency: 900 },

  // ── Web & Research ──────────────────────────────────────────────────────────
  { id: 'web-intel-v1', name: 'WebIntel', category: 'Web & Research', provider: 'ai', model: 'x402', price: 0.020,
    description: 'Fetches and reads web pages, then returns an LLM-written summary with the source links. Good for pulling context from docs, blogs, and announcements on demand.',
    capabilities: ['web-scraping', 'summarization', 'research'], score: 89, jobs: 1310, quality: 4.5, latency: 1800 },
  { id: 'newswire', name: 'NewsWire', category: 'Web & Research', provider: 'ai', model: 'x402', price: 0.015,
    description: 'Aggregated crypto and finance news from hundreds of sources, de-duplicated and ranked by relevance to your query, with timestamps and links.',
    capabilities: ['news', 'aggregation', 'research'], score: 87, jobs: 2240, quality: 4.3, latency: 700 },
  { id: 'deep-research', name: 'DeepResearch', category: 'Web & Research', provider: 'ai', model: 'mpp', price: 0.120,
    description: 'Multi-source research reports: the agent plans a search, reads across the web, and writes a structured report with citations. Streaming, priced by the depth of the run.',
    capabilities: ['research', 'reports', 'citations'], score: 90, jobs: 410, quality: 4.7, latency: 8600 },

  // ── Finance & DeFi ──────────────────────────────────────────────────────────
  { id: 'yield-scout', name: 'YieldScout', category: 'Finance & DeFi', provider: 'ai', model: 'x402', price: 0.030,
    description: 'Scans Stellar DeFi for the best available yields across Blend pools, Aquarius, and DeFindex, ranked by APY and adjusted for pool depth and risk.',
    capabilities: ['yield', 'defi', 'apy'], score: 85, jobs: 560, quality: 4.4, latency: 1200 },
  { id: 'portfolio-tracker', name: 'PortfolioTracker', category: 'Finance & DeFi', provider: 'ai', model: 'x402', price: 0.020,
    description: 'Values any Stellar wallet across trustlines and DeFi positions, with cost basis, unrealized P&L, and an allocation breakdown. Read-only, no keys required.',
    capabilities: ['portfolio', 'valuation', 'pnl'], score: 92, jobs: 1140, quality: 4.6, latency: 850 },
  { id: 'swap-router', name: 'SwapRouter', category: 'Finance & DeFi', provider: 'ai', model: 'x402', price: 0.010,
    description: 'Best-path swap quotes across the Stellar DEX and AMMs, returning the route, expected output, price impact, and a ready-to-sign path-payment. Quote only, you sign.',
    capabilities: ['swaps', 'routing', 'dex'], score: 90, jobs: 1670, quality: 4.5, latency: 540 },

  // ── Risk & Compliance ───────────────────────────────────────────────────────
  { id: 'sanctions-screen', name: 'SanctionsScreen', category: 'Risk & Compliance', provider: 'business', model: 'x402', price: 0.040,
    description: 'Screens a Stellar address against OFAC and other sanctions lists, returning a clear pass or hit with the matched entity and list. Built for regulated payment flows.',
    capabilities: ['sanctions', 'ofac', 'compliance'], score: 94, jobs: 830, quality: 4.7, latency: 480 },
  { id: 'rug-check', name: 'RugCheck', category: 'Risk & Compliance', provider: 'ai', model: 'x402', price: 0.035,
    description: 'Behavioral risk analysis for an asset issuer: freeze and clawback flags, signer setup, holder concentration, and recent privileged activity, distilled into a risk score.',
    capabilities: ['risk', 'token-analysis', 'issuer'], score: 83, jobs: 490, quality: 4.3, latency: 1600 },
  { id: 'wallet-reputation', name: 'WalletReputation', category: 'Risk & Compliance', provider: 'ai', model: 'x402', price: 0.025,
    description: 'Scores any wallet 0-100 for counterparty trust from on-chain history, age, and flow patterns, with a signal breakdown. Use it as a pre-payment check before you sign.',
    capabilities: ['reputation', 'trust', 'risk'], score: 88, jobs: 1260, quality: 4.5, latency: 720 },

  // ── Human Services ──────────────────────────────────────────────────────────
  { id: 'certified-translation', name: 'Certified Translation', category: 'Human Services', provider: 'human', model: 'mpp', price: 18.000,
    description: 'Certified human translation of legal and official documents by accredited linguists, with a signed certificate of accuracy. Delivery in 1-2 business days; paid on acceptance.',
    capabilities: ['translation', 'legal', 'certified'], score: 97, jobs: 210, quality: 4.9, latency: 129600000, fail: 0.01 },
  { id: 'contract-audit', name: 'Soroban Contract Audit', category: 'Human Services', provider: 'human', model: 'mpp', price: 1200.000,
    description: 'Expert manual security review of a Soroban smart contract by a senior auditor: a written report of findings by severity, with remediation guidance. Escrow-backed, paid on delivery.',
    capabilities: ['audit', 'security', 'soroban'], score: 98, jobs: 64, quality: 4.9, latency: 432000000, fail: 0.0 },
  { id: 'content-studio', name: 'Content Studio', category: 'Human Services', provider: 'human', model: 'mpp', price: 240.000,
    description: 'Human-written articles, docs, and whitepapers by vetted writers, with revisions. Ideal for launch content and technical explainers. Milestone-based, released on acceptance.',
    capabilities: ['writing', 'content', 'docs'], score: 91, jobs: 180, quality: 4.6, latency: 259200000, fail: 0.02 },
  { id: 'brand-design', name: 'Brand Design', category: 'Human Services', provider: 'human', model: 'mpp', price: 350.000,
    description: 'Logo and brand-asset design by human designers, delivered as source files with revision rounds. Subjective work, so it settles from escrow only when you accept.',
    capabilities: ['design', 'branding', 'logo'], score: 89, jobs: 145, quality: 4.5, latency: 345600000, fail: 0.03 },

  // ── Business Services ───────────────────────────────────────────────────────
  { id: 'kyc-verify', name: 'KYC Verify', category: 'Business Services', provider: 'business', model: 'x402', price: 1.500,
    description: 'Identity verification as a service: document and liveness checks with a pass or fail and a reference id, so agents and apps can onboard users compliantly.',
    capabilities: ['kyc', 'identity', 'onboarding'], score: 93, jobs: 3020, quality: 4.6, latency: 3400 },
  { id: 'payroll-payouts', name: 'Payroll Payouts', category: 'Business Services', provider: 'business', model: 'mpp', price: 5.000,
    description: 'Bulk USDC disbursement for payroll and contractor payments on Stellar, with per-recipient tracking and receipts. Priced per batch, settled from the vault.',
    capabilities: ['payroll', 'disbursement', 'payouts'], score: 90, jobs: 420, quality: 4.5, latency: 12000 },
  { id: 'data-labeling', name: 'Data Labeling', category: 'Business Services', provider: 'human', model: 'mpp', price: 0.080,
    description: 'Human-in-the-loop labeling and annotation for datasets, with quality review and consensus. Priced per item; large batches settle on delivery of the labeled set.',
    capabilities: ['labeling', 'annotation', 'data'], score: 86, jobs: 8900, quality: 4.3, latency: 900000, fail: 0.04 },
  { id: 'invoice-factoring', name: 'Invoice Factoring', category: 'Business Services', provider: 'business', model: 'mpp', price: 25.000,
    description: 'Short-term financing against business invoices, advancing USDC now and settling when the invoice is paid. Underwriting fee per invoice; regulated markets only.',
    capabilities: ['financing', 'invoices', 'credit'], score: 79, jobs: 96, quality: 4.1, latency: 86400000, fail: 0.05 },
];

function build(s: Seed) {
  const failed = Math.round(s.jobs * (s.fail ?? 0.03));
  return {
    agent_id: s.id,
    name: s.name,
    category: s.category,
    provider_type: s.provider,
    description: s.description,
    capabilities: s.capabilities,
    pricing: { model: s.model, price_per_call: s.price, currency: 'USDC' as const },
    endpoint: `https://demo.clevercon.app/${s.id}`,
    stellar_address: PLACEHOLDER_ADDR,
    status: 'inactive' as const,
    is_mock: true,
    registered_at: now(),
    last_seen: now(),
    reputation: {
      score: s.score,
      total_jobs: s.jobs,
      successful_jobs: s.jobs - failed,
      failed_jobs: failed,
      avg_quality: s.quality,
      avg_latency_ms: s.latency,
      last_updated: now(),
    },
  };
}

export const MOCK_AGENTS = SEEDS.map(build);
export const MOCK_CATEGORIES = Array.from(new Set(SEEDS.map((s) => s.category)));
