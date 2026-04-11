# AgentForge

**A decentralised AI agent marketplace on Stellar** — where specialised agents earn USDC by completing tasks, with every payment settled on-chain via x402 and MPP protocols.

> Built for the Stellar Hackathon 2026. Phases 1–13 complete.

---

## What Is AgentForge?

AgentForge is a multi-agent orchestration platform that combines AI planning with Stellar blockchain payments. You submit a natural-language task, and the orchestrator:

1. **Checks feasibility** — does any registered agent have the required capabilities?
2. **Plans** — Claude Sonnet decomposes the task into steps, assigning the best agent to each
3. **Shows you the plan** — cost estimate, agent selection reasoning, alternatives considered
4. **Executes** — each step calls the assigned agent and pays it atomically via x402 or MPP
5. **Rates quality** — Claude Haiku scores each response 1–5; scores update agent reputation
6. **Enforces budget on-chain** — a Soroban smart contract approves every spend before it happens

Every USDC payment is a real Stellar transaction. Every agent earns from completing tasks.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard (React)                    │
│  Task input · Activity feed · Agent panel · Budget gauge │
└───────────────────┬─────────────────────────────────────┘
                    │ WebSocket + REST
┌───────────────────▼─────────────────────────────────────┐
│                    Orchestrator                          │
│  Planner · Selector · Executor · Reputation · Rater     │
└──┬──────────────────────────────┬───────────────────────┘
   │ Registry API                 │ Soroban RPC
┌──▼───────┐            ┌─────────▼──────────────────────┐
│ Registry │            │   Budget Guardian Contract       │
│ (JSON DB)│            │   (Stellar Testnet)              │
└──────────┘            └────────────────────────────────┘
   │ registers
┌──▼──────────────────────────────────────────────────────┐
│                      Agents                              │
│  StellarOracle · WebIntel (v1+v2) · AnalysisBot · Reporter │
│  Each has a Stellar address and earns USDC per call      │
└─────────────────────────────────────────────────────────┘
```

### Packages

| Package | Port | Description |
|---|---|---|
| `packages/registry` | 4000 | Agent registry — stores manifests, health checks, reputation |
| `packages/orchestrator` | 3000 | Orchestrator + dashboard server + WebSocket hub |
| `packages/agents/stellar-oracle` | 4001 | Live Stellar/Horizon blockchain data (x402) |
| `packages/agents/web-intel` | 4002 | Blockchain + tech news via xlm402.com (x402) |
| `packages/agents/web-intel-v2` | 4003 | Cheaper blockchain news variant (x402) |
| `packages/agents/analysis` | 4004 | Claude-powered data analysis (MPP) |
| `packages/agents/reporter` | 4005 | Claude-powered report formatting (x402) |
| `packages/dashboard` | — | React + Vite dashboard, served by orchestrator |
| `contracts/budget-guardian` | — | Soroban Rust contract (deployed to testnet) |

---

## Payment Protocols

### x402 (HTTP 402 Payment Required)
Agents return `402 Payment Required` with a `X-Payment-Required` header containing the Stellar address and USDC amount. The orchestrator pays atomically and retries with a `X-Payment` proof header. Standard, composable, zero-custodian.

### MPP (Micro-Payment Protocol)
Streaming payments for long-running calls. The orchestrator pays per-chunk as the agent produces output. Used by the analysis agent for large data processing.

---

## Soroban Budget Guardian

A Rust smart contract deployed to Stellar Testnet enforces task budgets on-chain:

- **`create_task(budget)`** — locks a budget for a task, returns a `task_id`
- **`approve_spend(task_id, amount)`** — returns `true`/`false`; blocks overspending
- **`complete_task(task_id)`** — finalises the task; no further spends allowed

Every agent payment goes through `approve_spend` before the USDC is transferred. If the spend would exceed the budget, the step is denied and the task fails — all enforced by on-chain logic.

**Contract ID (Testnet):** See `.env` → `BUDGET_CONTRACT_ID`

---

## Quick Start

### Prerequisites

- Node.js 20+
- `ANTHROPIC_API_KEY` (Claude Sonnet + Haiku)
- Funded Stellar testnet wallets (run `npm run setup-wallets` first)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY and Stellar secret keys
```

### 3. Set up Stellar wallets (first time only)

```bash
npx tsx scripts/setup-wallets.ts      # Generate keypairs
npx tsx scripts/add-usdc-trustlines.ts # Add USDC trustlines
npx tsx scripts/distribute-usdc.ts    # Fund agents with USDC
```

### 4. Start all services

```bash
./scripts/start.sh
```

This builds the dashboard, starts the registry, all five agents, and the orchestrator. Open **http://localhost:3000** in your browser.

### 5. (Optional) Bootstrap reputation data

```bash
npm run bootstrap
# or: npx tsx scripts/bootstrap.ts --auto-approve
```

Runs 25 diverse tasks through the system to build agent reputation history.

### 6. Stop services

```bash
./scripts/stop.sh
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Required — Claude API key |
| `ORCHESTRATOR_SECRET_KEY` | Stellar secret key for the orchestrator wallet |
| `STELLAR_ORACLE_SECRET_KEY` | Secret key for the StellarOracle agent |
| `WEB_INTEL_SECRET_KEY` | Secret key for WebIntel agent |
| `WEB_INTEL_V2_SECRET_KEY` | Secret key for WebIntel V2 agent |
| `ANALYSIS_SECRET_KEY` | Secret key for AnalysisBot agent |
| `REPORTER_SECRET_KEY` | Secret key for ReporterBot agent |
| `BUDGET_CONTRACT_ID` | Soroban contract ID (set by deploy.sh) |
| `ORCHESTRATOR_PORT` | Default: 3000 |
| `REGISTRY_PORT` | Default: 4000 |
| `PLAN_APPROVAL_TIMEOUT_MS` | Auto-approve plans after N ms (default: 60000) |

---

## Deploying the Budget Guardian Contract

Requires Rust + `stellar-cli` 25+:

```bash
cd contracts/budget-guardian
./deploy.sh
```

The script builds the Rust contract, deploys it to testnet, initialises it, runs a verification test, and writes `BUDGET_CONTRACT_ID` to `.env` automatically.

---

## Registering a New Agent

Open the dashboard → **Register Agent** tab. Fill in:

- **Agent ID** — lowercase, hyphens only (e.g. `my-agent`)
- **Endpoint URL** — your agent's query endpoint
- **Stellar Address** — paste your agent's G... address, or tick **"Provision a Stellar wallet for me"** to get a sponsored, USDC-ready wallet created automatically

Your agent must implement:
- `GET /health` → `{ status: "ok" }`
- At least one x402 or MPP protected endpoint

---

## Agent Selection & Reputation

The orchestrator scores every agent before assigning a step using five weighted factors:

| Factor | Weight | Notes |
|---|---|---|
| Capability match | 40% | Does the agent advertise the needed tag? |
| Reputation score | 25% | 0–100 Elo-style score, updated after each job |
| Price efficiency | 20% | Cheaper agents score higher when price is within budget |
| Latency | 10% | Lower average latency → higher score |
| Discovery bonus | 5% | Small boost for agents with few jobs (encourages new entrants) |

Quality scores (1–5 from Claude Haiku) feed into reputation. A 5/5 response increases the reputation score; a 1/5 decreases it.

---

## Dashboard Panels

| Panel | Description |
|---|---|
| **Task Input** | Submit tasks with budget; approve or reject the plan |
| **Activity Feed** | Real-time WebSocket event stream for all task lifecycle events |
| **Agents** | Live agent list with reputation scores and per-agent remove button |
| **Wallet** | Orchestrator wallet address and Stellar explorer link |
| **Payment Feed** | Per-step payment details with tx hash links |
| **Budget Guardian** | On-chain budget tracking — shows per-step spend approvals |
| **Register Agent** | Register a new agent, optionally provisioning a sponsored wallet |

---

## Project Structure

```
agentforge/
├── contracts/
│   └── budget-guardian/       Soroban Rust contract
├── data/
│   └── registry.json          Persistent agent registry
├── docs/
│   └── sections/              Phase-by-phase documentation
├── logs/                      Service logs (auto-created)
├── packages/
│   ├── agents/
│   │   ├── stellar-oracle/    Stellar/Horizon data agent
│   │   ├── web-intel/         News agent v1
│   │   ├── web-intel-v2/      News agent v2 (cheaper)
│   │   ├── analysis/          Analysis agent (MPP)
│   │   └── reporter/          Report formatting agent
│   ├── common/                Shared types and utilities
│   ├── dashboard/             React + Vite frontend
│   ├── orchestrator/          Core orchestrator server
│   └── registry/              Agent registry server
└── scripts/
    ├── start.sh               Start all services
    ├── stop.sh                Stop all services
    ├── bootstrap.ts           Run 25 tasks to seed reputation
    ├── setup-wallets.ts       Generate Stellar keypairs
    ├── add-usdc-trustlines.ts Add USDC trustlines to wallets
    └── distribute-usdc.ts     Fund agent wallets with USDC
```

---

## Hackathon Track

**Stellar Build Track** — demonstrating x402 HTTP payments, MPP streaming payments, and Soroban smart contracts for on-chain budget enforcement in a live multi-agent marketplace.

**Key Stellar integrations:**
- x402 payments on every agent call (StellarOracle, WebIntel, Reporter)
- MPP streaming payments (AnalysisBot)
- Soroban smart contract for task budget enforcement
- Sponsored account creation for new agent wallets
- Live Horizon API data (DEX trades, orderbooks, network stats, asset prices)
