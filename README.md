<div align="center">

# CleverCon

**The non-custodial spending-control layer for AI agents on Stellar. Fund a vault, set private spending rules, and your agent spends within them, enforced on-chain.**

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF)](https://stellar.expert/explorer/testnet)
[![CleverVault](https://img.shields.io/badge/CleverVault-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CD3RTRZQE6ZU3FPU5GTMIS3II3C22OP22RTCAZ6AE3T3BI7XMTOKEMLA)
[![PolicyVerifier](https://img.shields.io/badge/PolicyVerifier-Deployed-00C853)](https://stellar.expert/explorer/testnet/contract/CBILHCY4FEYU7RMWBHJX42QJ5TILHZ33HNOD7A6FXTXKB7X57N4LZQ2D)

[Architecture](docs/architecture.md) · [Private policies spec](docs/private-policies.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## What it is

CleverCon is a spending-control layer for AI agents on Stellar. You fund a non-custodial vault, set private spending rules, and your agent spends within them. The contract holds the money and refuses any payment that breaks a rule, so the platform never has custody and the agent can never exceed the budget or pay an unapproved party.

Three things define it:

1. **Non-custodial, enforced on-chain.** A vault holds the funds and releases each payment only if it passes an on-chain policy check. Even a compromised or careless agent cannot exceed the budget or pay an unapproved party.
2. **The policy stays private.** The rules (your caps, allowlist, and limits) are committed and checked on-chain without being published, so the ledger shows that a payment was allowed without revealing the rule that allowed it. This is what separates CleverCon from transparent, custodial, or SDK-only alternatives.
3. **Useful from day one, no marketplace required.** Value is one-sided: a single developer with a single agent gets the full benefit immediately, even paying one endpoint. There is no two-sided liquidity to bootstrap.

It is live on Stellar testnet today: deployed contracts, a usable app, an SDK, and an MCP server that gives any AI agent a bounded, non-custodial spending account in minutes.

## Why it matters

Agents are starting to transact. The hard part is not moving money, Stellar already settles USDC in seconds for a fraction of a cent. The hard part is **letting an agent spend autonomously without handing it unbounded access to your funds**, and doing so without broadcasting your budget and business relationships to every competitor reading the chain.

CleverCon is the missing control layer: non-custodial custody of the funds, on-chain enforcement of what the agent may spend, and privacy of the policy itself. The fastest way in is MCP: point any MCP-capable agent (Claude Desktop, Cursor, a custom agent) at CleverCon and it gets a bounded spending account without custom integration. The SDK and dApp are the other two doors.

## Vision and goal

**Vision:** make Stellar the default rail AI agents spend through, because it is the only one where an agent's spending can be both enforced on-chain and kept private.

**Goal (next 6 to 12 months):**

- Harden the rail to a mainnet-credible state (security audit, disaster recovery, a clear testnet/mainnet switch).
- Land the full zero-knowledge policy circuit so "the policy stays private" holds under a formal soundness guarantee, not just the v1 binding proof (see [scope, honestly](#privacy-scope-stated-honestly)).
- Get real agent traffic through the rail with design partners, measured in on-chain payments.
- Publish the SDK and MCP server so third parties can embed the rail in a few lines.

## What makes it different

| | Transparent on-chain enforcers | Custodial agent wallets | SDK-only tools | **CleverCon** |
|---|---|---|---|---|
| Funds non-custodial | Varies | No | Varies | **Yes** |
| Spending enforced on-chain | Yes | No (off-chain) | No | **Yes** |
| Policy kept private | No | n/a | No | **Yes (v1 commitment + proof)** |
| Agent-native access (MCP) | Rare | Rare | No | **Yes** |

The closest ecosystem work enforces agent spending on-chain but leaves the policy public. CleverCon delivers the same on-chain enforcement and adds privacy of the policy, which is the part nobody else has.

<a id="privacy-scope-stated-honestly"></a>
### Privacy: scope, stated honestly

What is private today: the policy (your caps, allowlist, and per-payment limits) and the link between the policy and a release. The vault stores only a commitment to the rule, never the rule in the clear, and verifies a proof that each release obeys it.

What is not yet private: the v1 on-chain verifier is a binding check, not a full pairing verification, so v1 trusts the proving stack for soundness of the predicate. Fully hiding payment amounts and counterparties as well is the deeper end of the roadmap and depends on Stellar's upcoming confidential-token support. The normative threat model and limitations are frozen in [docs/private-policies.md](docs/private-policies.md). We state this plainly because precision here is a feature, not a caveat.

Landing the full zero-knowledge policy circuit, so soundness is formal and the binding-proof caveat is retired, is the headline roadmap item.

## How it works

1. **Fund.** Connect a wallet and deposit USDC into CleverVault, a non-custodial Soroban contract.
2. **Set a policy.** Commit a spending rule (a total budget, and optionally a per-payment cap and an allowlist of payees). In private mode only the commitment is stored; the rule itself is never persisted.
3. **Delegate spends.** A delegate (CleverCon's orchestrator, your own agent via the SDK, or an MCP client) pays services in USDC per step. The delegate holds no custody of the funds.
4. **Vault enforces + proves.** Each release calls the on-chain policy verifier with a proof bound to the specific payee and amount, with replay protection. Only an explicit pass moves funds; anything breaking the rule is refused.
5. **Settle exactly once.** Settlement is idempotent by (task, step) on-chain, so a retry or a race never double-pays. Unused budget is refunded and you can withdraw anytime.

The thing doing the spending is always just a **delegate**. The rail is what makes delegation safe: even a compromised delegate cannot spend outside the rule you set. The full fund-flow sequence and trust model are in [docs/architecture.md](docs/architecture.md).

### Three ways to spend

- **Pay a provider you already chose.** Point CleverCon at a specific service and make a single bounded, private payment. No planning.
- **Find and pay one service.** Describe what you need; the curated directory returns matching services by capability, price, and reputation. Pick one and pay.
- **Compose a multi-service job.** For work that spans services (gather data, analyze it, write a report), a delegate plans the steps, hires a service for each, and pays as each completes. Planning is optional and overridable; the rail underneath is identical.

The directory is a convenience for discovery, not the product. The product is the spending-control layer, which works whether you pay one endpoint or many.

## What runs today (Stellar testnet)

**On-chain (Soroban / Rust):**
- **CleverVault**: non-custodial deposits, per-task budget locking, proof-gated per-step release, refunds, multi-asset support, storage TTL management, and admin controls, with a 100+ case test suite.
- **PolicyVerifier**: an on-chain `verify_policy` entrypoint, fail-closed. A proof built by the TypeScript prover is accepted by the deployed contract on testnet, and a mismatched amount is rejected. This is a real cross-language prover-to-contract validation, not a mock.
- **Registry**: on-chain service registration and reputation.

**Backend (production rewrite, built for scale and concurrency):**
- **API** (NestJS): SEP-10 wallet auth, rotating JWT refresh, RBAC, hashed scoped API keys with daily usage quotas, step-up auth for money actions, rate limiting, structured logging, and an OpenTelemetry skeleton.
- **Indexer**: ingests on-chain events with a resumable cursor.
- **Workers** (BullMQ): task execution, proof generation, and exactly-once settlement.
- **Real-time**: Socket.IO with a Redis adapter for live task and proof updates.

**Product surfaces:**
- **Web app**: connect a wallet, add a USDC trustline, fund the vault, create a private policy, hire services, request a compliance proof, and watch releases settle, all live.
- **Service directory**: browse, search, filter, and sort a curated set of automated services an agent can hire (discovery, not a two-sided marketplace).
- **Admin console**: monitoring, user and role management, on-chain protocol-fee config, service moderation, and dispute arbitration.
- **Developer platform**: API keys with quotas, signed webhooks, a provider **SDK** (`@clevercon/agent-sdk`), and a Stellar **MCP server** (`@clevercon/mcp`, 10 tools) that hires and tracks tasks on the live rail.

**Proven end to end:** a full paid hire on testnet, where a real provider endpoint fulfilled a step and earned USDC through a proof-gated vault release.

**Recognition:** placed 2nd in the Stellar Agents hackathon.

## Architecture

```
clevercon/
├── contracts/                 Soroban / Rust
│   ├── agent-vault/           CleverVault: non-custodial treasury + proof-gated release
│   ├── policy-verifier/       on-chain verify_policy (private spending policies)
│   └── registry/              on-chain service registration + reputation
├── apps/
│   └── web/                   production app (React 19 + Vite + Tailwind)
├── services/
│   ├── api/                   NestJS API (auth, tasks, policies, vault, admin, dev platform)
│   ├── indexer/               on-chain event ingestion (resumable cursor)
│   ├── workers/               BullMQ: execution, proof generation, exactly-once settlement
│   └── reference-provider/    canonical provider implementing the fulfillment contract
├── packages/
│   ├── common/                shared types, policy-input encoding, binding-proof prover
│   ├── db/                    Prisma schema, client, secret crypto
│   ├── agent-sdk/             provider + agent SDK (createProvider, createAgent)
│   └── mcp/                   Stellar MCP server (discovery, vault, and hire-flow tools)
└── docs/                      architecture, private-policies spec, development
```

Public demo: [`packages/dashboard`](packages/dashboard) is a lightweight wallet-and-vault demo deployed on Vercel. Superseded by the production stack above: `packages/orchestrator`, `packages/registry`, `packages/agents`, and `contracts/budget-guardian` are the earlier hackathon stack, kept for history.

## Tech stack

| Layer | Technology |
|---|---|
| Smart contracts | Rust / Soroban (CleverVault, PolicyVerifier, Registry) |
| Zero-knowledge | Binding-proof prover today; full Noir / RISC Zero circuit on the roadmap, verified on-chain |
| Frontend | React 19, Vite, Tailwind, TanStack Query, Zustand |
| API | NestJS 11 (ESM + swc), PostgreSQL + Prisma, SEP-10 auth, RBAC |
| Async | Redis + BullMQ (execution, proofs, settlement), Socket.IO + Redis adapter |
| Payments | Vault-settled USDC release per step, proof-gated; x402 / MPP interop for external services on the roadmap |
| Wallets | `@creit.tech/stellar-wallets-kit` (Freighter, xBull, Albedo, LOBSTR, Rabet) |
| Chain access | `@stellar/stellar-sdk`, Soroban RPC, Horizon |

## Quick start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Docker (for PostgreSQL and Redis), or your own instances
- A Stellar wallet (Freighter) set to testnet

### Run the full stack locally

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
cp .env.example .env            # fill in the values (see docs/development.md)
npm install

docker compose up -d postgres redis
npm run -w @clevercon/db generate && npm run -w @clevercon/db push

# in separate terminals:
npm run dev -w @clevercon/api        # API on :4100
npm run dev -w @clevercon/workers    # execution, proofs, settlement
npm run dev -w @clevercon/indexer    # on-chain event ingestion
npm run dev -w @clevercon/web        # app on :5173
```

See [docs/development.md](docs/development.md) for the full environment and the reference provider. The public Vercel demo runs from `packages/dashboard` and talks to the contract directly, with no backend required.

### Use it from an AI agent (MCP)

Point any MCP client at `@clevercon/mcp` with `CLEVERCON_API_URL` and a scoped `CLEVERCON_API_KEY`, and the agent can search for services, hire one, and track the task on the live rail. See [packages/mcp/README.md](packages/mcp/README.md).

## Deployments (Stellar Testnet)

| Component | Address |
|---|---|
| CleverVault | [`CD3RTRZQ...TOKEMLA`](https://stellar.expert/explorer/testnet/contract/CD3RTRZQE6ZU3FPU5GTMIS3II3C22OP22RTCAZ6AE3T3BI7XMTOKEMLA) |
| PolicyVerifier | [`CBILHCY4...N4LZQ2D`](https://stellar.expert/explorer/testnet/contract/CBILHCY4FEYU7RMWBHJX42QJ5TILHZ33HNOD7A6FXTXKB7X57N4LZQ2D) |
| Registry | [`CAN2A7GA...AQ4H6RM`](https://stellar.expert/explorer/testnet/contract/CAN2A7GA2PNL4BYEBN3DZM3G74CNMJ2WAB2WTEMO4L6MIY5F2AQ4H6RM) |
| USDC (Circle testnet SAC) | [`CBIELTK6...HMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |

## Roadmap

Near-term, toward mainnet:

1. **Full ZK policy circuit** in CleverVault, so policy soundness is formal and the binding-proof caveat is retired.
2. **Security audit** of the contracts and API, plus a documented threat model and disaster-recovery runbook.
3. **Mainnet deploy** with a clear testnet/mainnet network switch.
4. **Real traction** with design partners, measured in on-chain payments.
5. **Published SDK and MCP** on npm for external install.

Longer-term: confidential amounts and counterparties (pending Stellar confidential tokens), deeper ecosystem integrations, and on-chain dispute resolution. Full detail in [ROADMAP.md](ROADMAP.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Private policies spec](docs/private-policies.md)
- [Development guide](docs/development.md)
- [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
