<div align="center">

# CleverCon

**The payment rail AI agents spend through on Stellar. Bounded by default, private by design.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO)

[Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## What it is

CleverCon is payment infrastructure for AI agents on Stellar. You hand an agent a budget, a non-custodial smart contract holds the money and enforces the limit, and the agent pays for the data, compute, and services it needs to do real work. It never holds your funds and never spends outside what you set.

Two things define it. The differentiator is **privacy**: spending rules enforced on-chain without exposing them (proof-gated hooks are built into the vault contract, with active zero-knowledge engine integration underway). And it is not just a protocol, it is a **live marketplace** you can use today.

## The marketplace

The part people actually touch. Connect a wallet, fund a non-custodial vault, and hire from an open marketplace of services that spans automated AI agents, human specialists, and business services, across categories like Data and Oracles, AI and Analysis, Web and Research, Finance and DeFi, Risk and Compliance, Human Services, and Business Services. Search, filter by category, and sort by rating, usage, price, or speed.

The vault holds the funds and releases payment per step, so the platform never has custody, and any HTTP service with a Stellar wallet and x402 or MPP support can register and earn. On testnet today you can connect a wallet, add USDC, deposit into the vault, check your balance, and browse the marketplace. The reference catalog shows the range of services the network is built for, and the registry is open for real providers to join.

## Privacy, the differentiator

Most agent-payment tools put your budget, your approved payees, and every payment on a public ledger for anyone to read. CleverCon is built so enforcement stays on-chain while the rules stay yours: a spending policy the contract checks without revealing it, and a proof that spending followed the policy without exposing it. That is what separates it from transparent, custodial, or SDK-only alternatives. It builds on the zero-knowledge engine already running on Stellar testnet as [CipherMit](https://github.com/Bosun-Josh121/ciphermit), and bringing it into CleverVault is the core of the roadmap.

For example: a trading firm funds an agent to buy research data and sets rules, only these five data providers, at most $100 per purchase, and $500 per week. Without privacy, a competitor reading the chain sees the firm's budget, which data providers it uses (its edge), and when it ramps spending before a trade. With CleverCon, the chain shows only "a payment happened and it was allowed", the budget, the providers, and the limits stay private, while the contract still refuses anything that breaks a rule. The mechanism is the same one that lets you prove you are over 21 without showing your birthdate: prove the spend followed the policy without revealing the policy.

Scope, stated honestly: in this privacy model, what stays private is the policy (your caps, allowlist, and limits) and the link between them. Note that while the proof-gated verification hooks (`create_task_with_policy`, `release_payment_proved`) are implemented in CleverVault, live on-chain zero-knowledge policy enforcement is currently being wired to the CipherMit engine on testnet (see Roadmap below). Fully hiding amounts and counterparties as well is the deeper end of the roadmap and leans on Stellar's upcoming confidential-token support.

## For builders: SDK and MCP

CleverCon is also infrastructure others build on. A reusable SDK lets any app or agent embed safe, private spending in a few calls, and a Stellar MCP server lets any AI agent discover and pay for services under a policy natively. These make the rail composable, not just a destination app. Both are on the roadmap.

## How it works

1. Connect a wallet and deposit USDC into CleverVault, a non-custodial contract.
2. Set your spending rules: a total budget, and (via the upcoming private policy integration) optional per-payment caps and payee allowlists kept private.
3. Spend, at whatever complexity the job needs (see "How you use it"). A delegate pays services in USDC, and the vault checks every release against your rules.
4. The vault caps spending and refunds the rest. You can withdraw anytime. The platform never holds your money.

## How you use it

The payment rail is always the same: bounded, private, per-step spending. How much coordination sits on top depends on the job, so CleverCon adapts instead of forcing everything through multi-step planning.

- **Pay a provider you already chose.** Point CleverCon at a specific service, set your rules, and it makes a single bounded, private payment. No planning, no matchmaking.
- **Find and pay one service.** Describe what you need; the open registry returns matching providers by capability, price, and reputation. Pick one, or take the top-ranked, and pay.
- **Compose a multi-service job.** For work that genuinely spans services (gather data, analyze it, write a report), a delegate plans the steps, hires a provider for each, and pays them in sequence as each completes. This is the only case that needs planning, and it stays optional and overridable.

In every case the vault enforces your budget (and, once private policies are active, your confidential spending rules). The thing doing the spending, CleverCon's orchestrator, your own agent via the SDK, or an MCP client, is just a **delegate**. The rail is what makes delegation safe: even a compromised or careless delegate cannot spend outside the rule you set. That, not the planning, is the point.

The full fund-flow sequence and trust model are in [docs/architecture.md](docs/architecture.md).

## What runs today

- **CleverVault**, a non-custodial Soroban contract on testnet: deposits, budget locking, per-step release, refunds, multi-asset support, admin controls, and proof-gated release hooks (`create_task_with_policy`, `release_payment_proved`), with a 100+ case test suite.
- **A usable dApp**: connect a wallet, add a USDC trustline, deposit, check balance, and withdraw, all signed in your wallet and settled directly against the contract with no server in the middle.
- **The marketplace**: browse, search, filter, and sort a catalog of services across seven categories and three provider types.
- **Orchestrator and open registry**, with **x402 and MPP payments** to services.
- Placed 2nd in the Stellar Agents hackathon.

Roadmap: full integration of the private spending policies described above (wiring the CipherMit zero-knowledge engine into CleverVault), an on-chain registry, the SDK, and the MCP server. See [ROADMAP.md](ROADMAP.md).

## Project structure

```
clevercon/
├── contracts/
│   ├── agent-vault/           CleverVault, the on-chain USDC treasury (Soroban/Rust)
│   └── budget-guardian/       earlier budget-tracking contract (legacy, unused)
├── packages/
│   ├── common/                shared TypeScript types, constants, wallet helpers
│   ├── registry/              service discovery and reputation API
│   ├── orchestrator/          planner, executor, vault client, WebSocket hub
│   ├── dashboard/             React 19 + Vite + Tailwind frontend
│   └── agents/                reference specialist services (oracle, web-intel, analysis, reporter)
├── scripts/                   setup, wallet, and lifecycle scripts
└── docs/                      architecture and development docs
```

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Rust / Soroban (CleverVault) |
| Zero-knowledge (direction) | RISC Zero and Noir circuits, verified on-chain, from the CipherMit engine |
| Frontend | React 19, Vite, Tailwind CSS, direct Soroban and Horizon calls |
| Backend | Node.js 20, Express, TypeScript (npm workspaces) |
| Payments | `@x402/express`, `@x402/stellar`, `@stellar/mpp` |
| Wallets | `@creit.tech/stellar-wallets-kit` (Freighter, xBull, Albedo, LOBSTR, Rabet) |
| Chain access | `@stellar/stellar-sdk`, Horizon, Soroban RPC |

## Quick start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Freighter (or another supported wallet) set to testnet
- An Anthropic API key, only if you run the orchestrator locally

### Install and run the dashboard

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
npm install
cd packages/dashboard
npm run dev
```

The dashboard talks to the contract directly, so wallet connect, the USDC trustline, and vault deposit, balance, and withdraw work on testnet without any backend. To run the full stack (orchestrator, registry, and the reference services), see [docs/development.md](docs/development.md).

## Deploying the dashboard (Vercel)

The dashboard is a static site and deploys on Vercel free:

1. Create a Vercel project from this repo.
2. Set the Root Directory to `packages/dashboard`.
3. Add the env var `VITE_BACKEND_ENABLED=false` for a standalone build (wallet and contract interactions stay real; orchestrator-backed features show a placeholder).
4. Build and output settings come from `packages/dashboard/vercel.json`.

To point the dashboard at a running backend later, set `VITE_API_URL` and `VITE_WS_URL` and set `VITE_BACKEND_ENABLED=true`.

## Deploying the CleverVault contract

Requires Rust and `stellar-cli` 25+:

```bash
cd contracts/agent-vault && ./deploy.sh
```

This builds to WASM, deploys, initializes, runs a smoke test, and writes `AGENT_VAULT_CONTRACT_ID` to `.env`.

## Deployments

| Component | Network | Address |
|---|---|---|
| CleverVault | Stellar Testnet | [`CC4QX7ZV...QVIXYRZO`](https://stellar.expert/explorer/testnet/contract/CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO) |
| USDC (SAC) | Stellar Testnet | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |

## Documentation

- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
