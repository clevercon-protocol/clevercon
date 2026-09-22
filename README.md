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

CleverCon lets you safely put an AI agent in charge of your money. You fund a non-custodial vault, set the limits it must obey (a budget, per-payment caps, an allowlist of who it may pay, time windows), optionally keep those limits private, then instruct your agent in plain terms to spend and disburse funds however serves your goal. The vault guarantees on-chain that the agent can never spend outside your rules or reveal them, and the platform never holds your funds.

It is delegation with hard limits: the agent owns the decisions (who to pay, when, how much, by whatever logic you give it); the contract owns the guarantee (bounds, privacy, non-custody). **Hiring services is one application of this, not the whole thing.**

Three things define it:

1. **Delegated decisions, hard limits.** The agent acts autonomously, but the vault releases a payment only if it passes an on-chain policy check, so even a compromised or careless agent cannot exceed the budget or pay an unapproved party.
2. **The rules stay private.** Your caps, allowlist, and limits are committed and checked on-chain without being published: the ledger shows a payment was allowed without revealing the rule that allowed it. This is what transparent enforcers and escrows cannot do.
3. **Useful from day one, no marketplace required.** Value is one-sided: a single developer with a single agent gets the full benefit immediately, even paying one address. There is no two-sided liquidity to bootstrap.

It is live on Stellar testnet today: deployed contracts, a usable app, an SDK, and an MCP server that gives any AI agent a bounded, non-custodial spending account in minutes.

## What you can use it for

The same primitive, bounded and private agent-driven payments, covers many jobs, not just hiring:

- **Autonomous disbursements and payouts** to a set of recipients, capped per payment and in total.
- **Recurring vendor, subscription, and API payments** within a budget.
- **Agent-to-agent payments**: one agent pays others for sub-tasks.
- **Treasury and ops automation**: an agent moves funds within a policy you can keep private.
- **Grant and bounty disbursement** to approved recipients, up to set limits.
- **Bounded allowances**: give an agent (or a sub-account) a private, capped wallet.
- **Buying data, compute, and services**: hire from the built-in directory or pay any provider.

In every case you set the limits once, the agent decides within them, and the vault enforces the boundary and keeps your rules private.

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

1. **Fund.** Connect a wallet and deposit USDC into CleverVault, a non-custodial Soroban contract. The platform never holds it.
2. **Set limits.** Create a reusable spending policy: a budget, and optionally a per-payment cap, an allowlist of payees, and a time window. You apply a policy per job and can keep several. In private mode only a commitment to the rule is stored; the rule itself is never persisted.
3. **Instruct your agent.** Point any agent at the vault (over MCP, the SDK, or the dApp) and tell it what to do. It decides who to pay, when, and how much within your limits; it never holds custody of your funds.
4. **The vault enforces and proves.** Each payment calls the on-chain policy verifier with a proof bound to the exact payee and amount, with replay protection. Only an explicit pass moves funds; anything breaking a rule is refused.
5. **Settle exactly once.** Releases are idempotent by (task, step) on-chain, so a retry or a race never double-pays. Unused budget is refunded, and you can withdraw anytime.

Two kinds of conditions: **spending bounds** (caps, allowlist, budget, time windows) are enforced on-chain by the policy; **event or business conditions** ("pay when X", on a schedule, "if approved") live in your agent, which triggers a payment the vault then checks. So the agent can be wrong about timing or choice within the allowed set, but never about the money boundary. The full fund-flow and trust model are in [docs/architecture.md](docs/architecture.md).

### Two ways funds move

- **Direct (registered services and any Stellar address you allowlist):** the vault pays the payee directly under your policy. Strongest guarantee: payee and amount are enforced on-chain, and the platform never holds funds.
- **Agent-key (the open x402/MPP economy):** the vault tops up your agent's own key in bounded amounts under your policy, and your agent signs the external payment. This reaches services outside CleverCon while the budget and privacy stay enforced; the platform still never holds funds. Implemented and proven end to end on testnet: `createAgentWallet` in the SDK unites the governed top-up with an x402-paying fetch, and the vault, agent wallet, and external x402 service all settle in the same Stellar USDC through the public facilitator.

### Hiring services (one application)

When the payees are service providers, hiring takes three shapes:

- **Pay a provider you chose.** Point CleverCon at a specific service and make a single bounded, private payment.
- **Find and pay one service.** Describe what you need; the curated directory returns matching services by capability, price, and reputation. Pick one and pay.
- **Compose a multi-service job.** For work that spans services (gather data, analyze it, write a report), your agent plans the steps, hires a service for each, and pays as each completes.

The directory is discovery, not the product. The product is the spending-control layer, which works whether your agent pays one address or many, services or otherwise.

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
- **Developer platform**: API keys with quotas, signed webhooks, an **SDK** (`@clevercon/agent-sdk`: `createSpender` for a bounded spending account, `createAgentWallet` for x402 agent-key mode, `createProvider`/`createAgent` to be a paid service), and a Stellar **MCP server** (`@clevercon/mcp`, 12 tools) that pays, disburses, hires, and tracks on the live rail.

**Proven end to end:** a headless testnet harness (`scripts/e2e-testnet.ts`, 29 stages) drives the whole loop with a fresh keypair and no browser: fund, set a policy, authorize the delegate, pay, disburse, hire a live provider, spend via the SDK and MCP, top up an agent wallet and pay an external x402 service, receive a signed webhook, retry idempotently, then withdraw. Every stage is a real on-chain settlement.

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
│   ├── agent-sdk/             SDK: createSpender, createAgentWallet, createProvider, createAgent
│   └── mcp/                   Stellar MCP server (spend, disburse, hire, limits, budget: 12 tools)
└── docs/                      architecture, private-policies spec, development
```

Public demo: [`packages/dashboard`](packages/dashboard) is a lightweight wallet-and-vault demo deployed on Vercel (contract-direct, no backend). The earlier hackathon stack (an Express orchestrator, a JSON registry, sample agents, and the budget-guardian contract) has been removed to keep the repo focused on the product; it remains in the git history.

## Tech stack

| Layer | Technology |
|---|---|
| Smart contracts | Rust / Soroban (CleverVault, PolicyVerifier, Registry) |
| Zero-knowledge | Noir circuit (`circuits/spend-policy`) built and proven in CI; on-chain verification is a binding check today, full pairing verification pending Stellar precompiles |
| Frontend | React 19, Vite, Tailwind, TanStack Query, Zustand |
| API | NestJS 11 (ESM + swc), PostgreSQL + Prisma, SEP-10 auth, RBAC |
| Async | Redis + BullMQ (execution, proofs, settlement), Socket.IO + Redis adapter |
| Payments | Direct vault-settled USDC releases (proof-gated) to allowlisted addresses; agent-key mode for the external x402 / MPP economy (implemented, proven on testnet via `createAgentWallet`) |
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
- [Operations and disaster recovery](docs/operations.md)
- [Development guide](docs/development.md)
- [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
