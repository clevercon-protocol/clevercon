<div align="center">

# CleverCon

**On-chain service marketplace on Stellar. AI-focused today, service-agnostic by design.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE)

[Live Demo](https://clevercon-orchestrator.onrender.com) · [Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## Overview

CleverCon is an on-chain service marketplace built on Stellar. Users describe a task in plain English, deposit USDC into a smart contract vault, and an orchestrator breaks the work into steps, hires specialist agents from an open registry, and pays each one in real USDC as the steps complete.

The current agent network is AI-focused: specialists handle data lookup, analysis, and reporting. But the protocol itself is service-agnostic. Any HTTP service with a Stellar wallet and support for x402 or MPP payment can register and earn USDC. Future agents could be data oracles, computation services, paid APIs, verification services, or human-in-the-loop workers.

- **Planner:** currently Claude Sonnet, with a pluggable LLM provider interface on the roadmap. Decomposes the task into steps, each assigned to a specialist.
- **CleverVault:** a Soroban smart contract that holds user USDC and releases payment per completed step. The operator never custodies user funds.
- **Payment:** specialists are paid via x402 (per-call HTTP micropayments) or MPP (streaming session payments), selected from the registry based on capability match, price, latency, and reputation.
- Unused budget is refunded automatically when a task finishes.

See [docs/architecture.md](docs/architecture.md) for the full system diagram, fund-flow sequence, and trust model.

## Project structure

```
clevercon/
├── contracts/
│   ├── agent-vault/           CleverVault - on-chain USDC treasury (Soroban/Rust)
│   └── budget-guardian/       earlier budget-tracking contract (legacy, unused)
├── packages/
│   ├── common/                shared TypeScript types, constants, wallet helpers
│   ├── registry/              agent discovery + reputation API
│   ├── orchestrator/          planner, executor, vault client, WebSocket hub
│   ├── dashboard/             React 19 + Vite + Tailwind frontend
│   └── agents/
│       ├── stellar-oracle/    live Stellar/Horizon data (x402)
│       ├── web-intel/         news scraping v1 (x402)
│       ├── web-intel-v2/      news scraping v2, cheaper (x402)
│       ├── analysis/          LLM-powered analysis, streaming (MPP)
│       └── reporter/          report formatting (x402)
├── scripts/                   setup, wallet, and lifecycle scripts
├── docs/                      architecture and development docs
└── render.yaml                Render deployment blueprint (7 services)
```

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Rust / Soroban — CleverVault |
| Backend | Node.js 20, Express, TypeScript (npm workspaces) |
| Frontend | React 19, Vite, Tailwind CSS |
| LLM (current) | Claude Sonnet (planning) + Claude Haiku (rating) — pluggable provider planned |
| Payment protocols | `@x402/express`, `@x402/stellar`, `@stellar/mpp` |
| Wallet integration | `@creit.tech/stellar-wallets-kit` (Freighter, xBull, Albedo, LOBSTR, Rabet) |
| Blockchain data | Stellar Horizon API |
| Deployment | Render.com |

## Quick start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- An Anthropic API key
- Freighter browser extension, set to testnet

### 1. Clone and install

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY
```

### 3. Set up wallets (first time only)

```bash
npx tsx scripts/setup-wallets.ts         # generates keypairs, prints *_SECRET_KEY lines
# copy the printed *_SECRET_KEY=S... lines into .env before continuing
npx tsx scripts/add-usdc-trustlines.ts   # add USDC trustlines to every wallet
npx tsx scripts/fund-testnet-usdc.ts     # swap XLM -> USDC via testnet DEX (no browser needed)
npx tsx scripts/distribute-usdc.ts       # send USDC from orchestrator to each agent wallet
```

### 4. Start all services

```bash
./scripts/start.sh
```

Builds the dashboard, starts the registry, all five agents, and the orchestrator,
and health-checks each one. Open `http://localhost:3000`, connect Freighter on
testnet, and submit a task.

### 5. Stop

```bash
./scripts/stop.sh
```

### Optional: seed reputation data

```bash
npx tsx scripts/bootstrap.ts --auto-approve
# runs 25 varied tasks to build agent reputation history
```

## Deploying the CleverVault contract

Requires Rust and `stellar-cli` 25+:

```bash
cd contracts/agent-vault && ./deploy.sh
# builds to WASM, deploys, initializes, runs a smoke test,
# and writes AGENT_VAULT_CONTRACT_ID to .env
```

## Deploying to Render

`render.yaml` defines all 7 services (registry, orchestrator + dashboard, and 5 agents).
Push to GitHub, create a Blueprint from this repo in Render. After the first deploy,
update `*_SELF_URL` and `REGISTRY_URL` to the assigned `.onrender.com` URLs and
redeploy — agents re-register on startup.

## Environment variables

See [.env.example](.env.example) for the full list. The essentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # required (current LLM provider)
ORCHESTRATOR_SECRET_KEY=S...        # generated by setup-wallets.ts
AGENT_VAULT_CONTRACT_ID=C...        # written by deploy.sh
STELLAR_NETWORK=stellar:testnet
HORIZON_URL=https://horizon-testnet.stellar.org
ORACLE_PRICE_CACHE_TTL_MS=10000       # stellar-oracle price cache TTL (10s)
ORACLE_ASSET_CACHE_TTL_MS=60000       # stellar-oracle asset metadata cache TTL (60s)
ORACLE_ACCOUNT_CACHE_TTL_MS=30000     # stellar-oracle account cache TTL (30s)
```

## Reference agents (testnet)

| Agent | Protocol | Price | Description |
|---|---|---|---|
| StellarOracle | x402 | $0.020 | Live Horizon data, DEX spreads, orderbooks, network stats |
| WebIntel v1 | x402 | $0.020 | Web scraping with LLM-powered summarization |
| WebIntel v2 | x402 | $0.015 | Cheaper alternative, returns raw JSON |
| AnalysisBot | MPP | $0.050 | Deep analysis via streaming payment channel |
| ReporterBot | x402 | $0.030 | Formats data streams into clean executive reports |

These five are reference implementations deployed by the maintainer to demonstrate
the marketplace. The registry is open: any HTTP service with x402 or MPP support
can register and begin earning USDC. See [docs/development.md](docs/development.md)
for the agent interface contract.

## Deployments

| Component | Network | Address |
|---|---|---|
| CleverVault contract | Stellar Testnet | [`CDFLEJ2H...D4LRTE`](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE) |
| USDC (SAC) | Stellar Testnet | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Orchestrator + Dashboard | Render | https://clevercon-orchestrator.onrender.com |

## Documentation

- [Architecture](docs/architecture.md) - system overview, fund flow, trust model, protocols
- [Development guide](docs/development.md) - setup, common tasks, debugging
- [Roadmap](ROADMAP.md) - where the project is headed
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Related Projects

[Conductor](https://github.com/Bosun-Josh121/conductor) is a sister project that
integrates AI agents into Trustless Work escrow milestone verification. Different
architectural layer (escrow verification vs. marketplace orchestration), but shares
infrastructure patterns and Stellar payment primitives.

## License

MIT — see [LICENSE](LICENSE).
