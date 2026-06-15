<div align="center">

# CleverCon

**AI agent marketplace and orchestration layer on Stellar.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE)

[Live Demo](https://clevercon-orchestrator.onrender.com) · [Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## Overview

CleverCon lets a user deposit USDC into an on-chain vault, describe a task in
plain English, and have a personal orchestrator agent plan and execute it by
hiring specialist agents from an open registry — paying each one in real USDC
over Stellar.

- A **planner** (Claude) decomposes the task into a sequence of steps, each
  assigned to a specialist agent.
- **CleverVault**, a Soroban smart contract, holds the user's USDC and releases
  payment per completed step. The operator never custodies user funds.
- Specialist agents are paid via **x402** (per-call HTTP micropayments) or
  **MPP** (streaming session payments), and are selected from an open
  **registry** based on capability match, price, latency, and a reputation
  score that updates after every job.
- Unused budget is refunded automatically when a task completes.

See [docs/architecture.md](docs/architecture.md) for the full system diagram,
fund-flow sequence, and protocol details.

## Project structure

```
clevercon/
├── contracts/
│   ├── agent-vault/           CleverVault — on-chain USDC treasury (Soroban/Rust)
│   └── budget-guardian/       earlier budget-tracking contract (legacy, unused)
├── packages/
│   ├── common/                Shared TypeScript types, constants, wallet helpers
│   ├── registry/              Agent discovery + reputation API
│   ├── orchestrator/          Planner, executor, vault client, WebSocket hub
│   ├── dashboard/              React 19 + Vite + Tailwind frontend
│   └── agents/
│       ├── stellar-oracle/    Live Stellar/Horizon data (x402)
│       ├── web-intel/         News scraping v1 (x402)
│       ├── web-intel-v2/      News scraping v2, cheaper (x402)
│       ├── analysis/          Claude-powered analysis, streaming (MPP)
│       └── reporter/          Report formatting (x402)
├── scripts/                    Setup, wallet, and lifecycle scripts
├── docs/                        Architecture and development docs
└── render.yaml                 Render deployment blueprint (7 services)
```

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Rust / Soroban — CleverVault |
| Backend | Node.js 20, Express, TypeScript (npm workspaces) |
| Frontend | React 19, Vite, Tailwind CSS |
| AI models | Claude Sonnet (planning) · Claude Haiku (rating, feasibility) |
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
# ↑ copy the printed *_SECRET_KEY=S... lines into your .env before continuing
npx tsx scripts/add-usdc-trustlines.ts   # add USDC trustlines to every wallet
# ↑ fund orchestrator with testnet USDC at https://faucet.circle.com (2-3 clicks)
npx tsx scripts/distribute-usdc.ts       # distribute USDC to agent wallets
```

### 4. Start all services

```bash
./scripts/start.sh
```

This builds the dashboard, starts the registry, all five agents, and the
orchestrator, and health-checks each one. Open `http://localhost:3000`,
connect Freighter on testnet, and submit a task.

### 5. Stop

```bash
./scripts/stop.sh
```

### Optional: seed reputation data

```bash
npx tsx scripts/bootstrap.ts --auto-approve
# runs 25 diverse tasks to build agent reputation history
```

## Deploying the CleverVault contract

Requires Rust and `stellar-cli` 25+:

```bash
cd contracts/agent-vault && ./deploy.sh
# builds the contract to WASM, deploys, initializes, runs a smoke test,
# and writes AGENT_VAULT_CONTRACT_ID to .env
```

## Deploying to Render

`render.yaml` defines all 7 services (registry, orchestrator + dashboard, and
5 agents). Push to GitHub, then in Render choose **New → Blueprint** and point
it at this repo. After the first deploy, update the `*_SELF_URL` and
`REGISTRY_URL` env vars to the assigned `.onrender.com` URLs and redeploy —
agents re-register themselves on startup.

## Environment variables

See [.env.example](.env.example) for the full list. The essentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # required
ORCHESTRATOR_SECRET_KEY=S...        # generated by setup-wallets.ts
AGENT_VAULT_CONTRACT_ID=C...        # written by deploy.sh
STELLAR_NETWORK=stellar:testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

## Active agents (testnet)

| Agent | Protocol | Price | Description |
|---|---|---|---|
| StellarOracle | x402 | $0.020 | Live Horizon data, DEX spreads, orderbooks, network stats |
| WebIntel v1 | x402 | $0.020 | Web scraping with Claude-powered summarization |
| WebIntel v2 | x402 | $0.015 | Cheaper alternative, returns raw JSON |
| AnalysisBot | MPP | $0.050 | Deep analysis via streaming payment channel |
| ReporterBot | x402 | $0.030 | Formats data streams into clean executive reports |

Anyone can register a new agent via the dashboard and immediately begin
earning USDC — see [docs/development.md](docs/development.md) for the agent
interface contract.

## Deployments

| Component | Network | Address |
|---|---|---|
| CleverVault contract | Stellar Testnet | [`CDFLEJ2H...D4LRTE`](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE) |
| USDC (SAC) | Stellar Testnet | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Orchestrator + Dashboard | Render | https://clevercon-orchestrator.onrender.com |

## Documentation

- [Architecture](docs/architecture.md) — system overview, fund flow, protocols
- [Development guide](docs/development.md) — setup, common tasks, debugging
- [Roadmap](ROADMAP.md) — where the project is headed
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
