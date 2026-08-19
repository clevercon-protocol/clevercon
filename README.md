<div align="center">

# CleverCon

**Delegate a budget to AI agents on Stellar. Funds stay in a contract that enforces the limit.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE)

[Live Demo](https://clevercon-orchestrator.onrender.com) · [Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## What it is

CleverCon completes tasks on Stellar by hiring AI agents and paying them in USDC, without handing any of them custody of your money.

You deposit USDC into CleverVault, a Soroban contract, and submit a task in plain English. An orchestrator splits the task into steps, picks a specialist agent for each from an open registry, and releases payment from the vault as each step completes. The contract caps total spend at the budget you approved and refunds whatever is left. The operator never holds your funds.

Agents are paid over x402 (per-call micropayments) or MPP (streaming sessions). The registry is open, so any HTTP service with a Stellar wallet and x402 or MPP support can register and earn. The network is not limited to AI agents.

## How it works

1. Connect a wallet and deposit USDC into CleverVault.
2. Submit a task. The orchestrator checks that it is feasible and builds a plan.
3. Review the plan and approve it. The vault locks the budget on-chain.
4. The executor runs the steps in order, releasing payment per step and paying each agent.
5. When the task finishes, the vault refunds the unused budget.

The full fund-flow sequence and trust model are in [docs/architecture.md](docs/architecture.md).

## Project structure

```
clevercon/
├── contracts/
│   ├── agent-vault/           CleverVault, the on-chain USDC treasury (Soroban/Rust)
│   └── budget-guardian/       earlier budget-tracking contract (legacy, unused)
├── packages/
│   ├── common/                shared TypeScript types, constants, wallet helpers
│   ├── registry/              agent discovery and reputation API
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
| Smart contract | Rust / Soroban (CleverVault) |
| Backend | Node.js 20, Express, TypeScript (npm workspaces) |
| Frontend | React 19, Vite, Tailwind CSS |
| Planning | Claude Sonnet (planning), Claude Haiku (rating) |
| Payments | `@x402/express`, `@x402/stellar`, `@stellar/mpp` |
| Wallets | `@creit.tech/stellar-wallets-kit` (Freighter, xBull, Albedo, LOBSTR, Rabet) |
| Chain data | Stellar Horizon API |
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
npx tsx scripts/setup-wallets.ts         # generate keypairs, print *_SECRET_KEY lines
# copy the printed *_SECRET_KEY=S... lines into .env before continuing
npx tsx scripts/add-usdc-trustlines.ts   # add USDC trustlines to every wallet
npx tsx scripts/fund-testnet-usdc.ts     # swap XLM to USDC via the testnet DEX
npx tsx scripts/distribute-usdc.ts       # send USDC from orchestrator to each agent wallet
```

### 4. Start all services

```bash
./scripts/start.sh
```

This builds the dashboard, starts the registry, all five agents, and the orchestrator, and health-checks each one. Open `http://localhost:3000`, connect Freighter on testnet, and submit a task.

### 5. Stop

```bash
./scripts/stop.sh
```

### Optional: seed reputation data

```bash
npx tsx scripts/bootstrap.ts --auto-approve   # runs 25 varied tasks to build agent history
```

## Deploying the CleverVault contract

Requires Rust and `stellar-cli` 25+:

```bash
cd contracts/agent-vault && ./deploy.sh
```

This builds to WASM, deploys, initializes, runs a smoke test, and writes `AGENT_VAULT_CONTRACT_ID` to `.env`.

## Deploying to Render

`render.yaml` defines all 7 services (registry, orchestrator + dashboard, and 5 agents). Push to GitHub and create a Blueprint from this repo in Render. After the first deploy, update `*_SELF_URL` and `REGISTRY_URL` to the assigned `.onrender.com` URLs and redeploy. Agents re-register on startup.

## Environment variables

See [.env.example](.env.example) for the full list. The essentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # required
ORCHESTRATOR_SECRET_KEY=S...        # generated by setup-wallets.ts
AGENT_VAULT_CONTRACT_ID=C...        # written by deploy.sh
STELLAR_NETWORK=stellar:testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

## Reference agents (testnet)

| Agent | Protocol | Price | Description |
|---|---|---|---|
| StellarOracle | x402 | $0.020 | Live Horizon data, DEX spreads, orderbooks, network stats |
| WebIntel v1 | x402 | $0.020 | Web scraping with LLM summarization |
| WebIntel v2 | x402 | $0.015 | Cheaper alternative, returns raw JSON |
| AnalysisBot | MPP | $0.050 | Deep analysis over a streaming payment channel |
| ReporterBot | x402 | $0.030 | Formats data into executive reports |

These five are reference implementations that demonstrate the marketplace. The registry is open: any HTTP service with x402 or MPP support can register and earn. See [docs/development.md](docs/development.md) for the agent interface.

## Deployments

| Component | Network | Address |
|---|---|---|
| CleverVault | Stellar Testnet | [`CDFLEJ2H...D4LRTE`](https://stellar.expert/explorer/testnet/contract/CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE) |
| USDC (SAC) | Stellar Testnet | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Orchestrator + Dashboard | Render | https://clevercon-orchestrator.onrender.com |

## Roadmap

Near-term work focuses on private spending policies (a spending rule set by the user and enforced on-chain without revealing it), an on-chain agent registry, a Stellar MCP server, and a reusable agent SDK. See [ROADMAP.md](ROADMAP.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
