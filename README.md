<div align="center">

# CleverCon

**Money your AI agent can use, under rules it can't break.**

A private, non-custodial spending account for AI agents on Stellar, and an economy to use it in: pay a vendor, disburse to many, hire services, and pay other agents, all within limits only you set and no one else can see.

[![CI](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml/badge.svg)](https://github.com/clevercon-protocol/clevercon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Built%20on-Stellar-7B2FFF)](https://stellar.org)
[![npm: agent-sdk](https://img.shields.io/npm/v/@clevercon/agent-sdk?label=%40clevercon%2Fagent-sdk&color=CB3837&logo=npm)](https://www.npmjs.com/package/@clevercon/agent-sdk)
[![npm: mcp](https://img.shields.io/npm/v/@clevercon/mcp?label=%40clevercon%2Fmcp&color=CB3837&logo=npm)](https://www.npmjs.com/package/@clevercon/mcp)

[Website](https://clevercon.xyz) · [Architecture](docs/architecture.md) · [Private policies](docs/private-policies-v2.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

## What it is

CleverCon gives an AI agent a private, non-custodial spending account on Stellar. You fund a vault, set the rules the agent must obey, a budget, per-payment caps, an allowlist of who it may pay, time windows, how often it may pay, and keep those rules private. Your agent can then pay a vendor, disburse to many recipients, hire services and pay per call, or pay other agents, all within limits only you set.

The vault holds your funds non-custodially and releases a payment only when a zero-knowledge proof shows it obeys your committed rules. The rules are enforced on-chain but never published, and the platform never takes custody of your funds.

Three things define it:

1. **Bounded and non-custodial.** The agent decides who to pay, when, and how much, but the vault releases a payment only if it passes an on-chain policy check. Even a compromised or careless agent cannot exceed the budget or pay someone you did not approve, and the platform never holds your money.
2. **Private.** Your caps, allowlist, and limits are committed and verified on-chain with zero-knowledge proofs, without being published. The ledger shows that a payment was allowed without revealing the rule that allowed it. (What stays private is the policy; amounts and destinations are public on the ledger, like any Stellar payment.)
3. **A real economy, not just a wallet.** Direct payments and disbursements to any allowlisted address, plus a service directory where agents hire and pay per call, with on-chain reputation. Reachable from a web app, an SDK, or an MCP server.

## Why it matters

Agents are starting to transact, and the hard part isn't moving money, Stellar already settles USDC in seconds for a fraction of a cent. The hard part is letting an agent spend autonomously **without** handing it unbounded access to your funds, and doing so **without** broadcasting your budget and business relationships to everyone reading the chain.

CleverCon is that control layer: non-custodial custody of the funds, on-chain enforcement of what the agent may spend, and privacy of the policy itself. Point any MCP-capable agent (Claude, Cursor, your own) at it and it gets a bounded spending account with no custom integration.

## What you can use it for

The same primitive, bounded and private agent-driven payments, covers many jobs:

- **Autonomous disbursements and payouts** to a set of recipients, capped per payment and in total.
- **Recurring vendor, subscription, and API payments** within a budget.
- **Agent-to-agent payments**: one agent pays others for sub-tasks.
- **Treasury and ops automation**: an agent moves funds within a policy you keep private.
- **Grant and bounty disbursement** to approved recipients, up to set limits.
- **Bounded allowances**: give an agent a private, capped wallet.
- **Buying data, compute, and services**: hire from the directory or pay any provider.

In every case you set the limits once, the agent decides within them, and the vault enforces the boundary and keeps your rules private.

## How it works

1. **Fund.** Deposit USDC into the vault, a non-custodial Soroban contract. The platform never holds it.
2. **Set rules.** Create a reusable spending policy, a budget, and optionally a per-payment cap, an allowlist of payees, per-payee caps, time windows, and a velocity limit. Only a commitment to the rule goes on-chain; the rule itself is never published.
3. **Instruct your agent.** Point any agent at the vault over MCP, the SDK, or the web app and tell it what to do. It decides who to pay, when, and how much within your limits.
4. **The vault enforces and proves.** Each payment is gated by a zero-knowledge proof, generated on your side, that the payees and amounts obey your committed policy. The chain verifies the proof before any funds move; anything breaking a rule is refused.
5. **Settle exactly once.** Releases are idempotent on-chain, so a retry or race never double-pays. Unused budget is refunded, and you can withdraw anytime.

Two kinds of conditions: **spending bounds** (caps, allowlist, budget, time windows) are enforced on-chain by the policy; **event conditions** ("pay when X", on a schedule, "if approved") live in your agent, which triggers a payment the vault then checks. So the agent can be wrong about timing or choice within the allowed set, but never about the money boundary. Full detail in [docs/architecture.md](docs/architecture.md).

## Three doors

- **Web app** ([clevercon.xyz](https://clevercon.xyz)): connect a wallet, fund the vault, build a private policy, instruct an agent in plain language, disburse to many, and watch releases settle, with the proof generated in your browser.
- **SDK** ([`@clevercon/agent-sdk`](https://www.npmjs.com/package/@clevercon/agent-sdk)): `createSpender` for a bounded spending account, `createAgentWallet` for the external x402 economy, and `createProvider` / `createAgent` to be a paid service. `npm install @clevercon/agent-sdk` · [docs](packages/agent-sdk).
- **MCP server** ([`@clevercon/mcp`](https://www.npmjs.com/package/@clevercon/mcp)): give any MCP-capable agent a spending account, it can pay, disburse, hire, set limits, and read its budget on the live rail. `npm install @clevercon/mcp` · [docs](packages/mcp).

## What makes it different

|  | Transparent on-chain enforcers | Custodial agent wallets | SDK-only tools | **CleverCon** |
|---|---|---|---|---|
| Funds non-custodial | Varies | No | Varies | **Yes** |
| Spending enforced on-chain | Yes | No (off-chain) | No | **Yes** |
| Policy kept private | No | n/a | No | **Yes** |
| Agent-native access (MCP) | Rare | Rare | No | **Yes** |
| A built-in economy to spend in | No | No | No | **Yes** |

Others enforce agent spending on-chain but leave the policy public, or offer a private account with no economy around it. CleverCon is the only one with on-chain enforcement, a private policy, **and** an agent economy to use it in.

## Repository structure

```
clevercon/
├── contracts/                 Soroban / Rust
│   ├── agent-vault/           non-custodial treasury + proof-gated release
│   ├── policy-verifier/       on-chain zero-knowledge proof verification
│   └── registry/              on-chain service registration + reputation
├── apps/web/                  web app (React + Vite + Tailwind)
├── services/
│   ├── api/                   NestJS API (auth, tasks, policies, vault, admin)
│   ├── indexer/               on-chain event ingestion (resumable cursor)
│   ├── workers/               BullMQ: execution, proving, exactly-once settlement
│   └── reference-provider/    canonical paid-service implementation
├── packages/
│   ├── common/                shared types + policy encoding
│   ├── db/                     Prisma schema, client, secret crypto
│   ├── agent-sdk/             SDK: createSpender / createAgentWallet / createProvider
│   └── mcp/                    MCP server for agents
├── circuits/                  zero-knowledge spending-policy circuits
└── docs/                      architecture, private-policies spec, development
```

## Quick start

**Prerequisites:** Node.js 20+ (see `.nvmrc`), Docker (for PostgreSQL and Redis), and a Stellar wallet (Freighter) on testnet.

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
cp .env.example .env            # fill in the values (see docs/development.md)
npm install

docker compose up -d postgres redis
npm run -w @clevercon/db generate && npm run -w @clevercon/db push

# in separate terminals:
npm run dev -w @clevercon/api        # API
npm run dev -w @clevercon/workers    # execution, proving, settlement
npm run dev -w @clevercon/indexer    # on-chain event ingestion
npm run dev -w @clevercon/web        # web app
```

`apps/web` has a backendless demo mode (`VITE_BACKEND=demo`) for a no-backend preview. See [docs/development.md](docs/development.md) for the full setup.

**From an agent (MCP):** point any MCP client at `@clevercon/mcp` with `CLEVERCON_API_URL` and a scoped `CLEVERCON_API_KEY`. See [packages/mcp/README.md](packages/mcp/README.md).

## Deployments (Stellar testnet)

| Component | Address |
|---|---|
| Vault | [`CCLUFH2E…NU44V`](https://stellar.expert/explorer/testnet/contract/CCLUFH2E5UMJCNB4ZEH3ZP6LGER54J6GSG3YY55T4CIMPSZROU2NU44V) |
| PolicyVerifier | [`CAZ2VC6P…HNRP`](https://stellar.expert/explorer/testnet/contract/CAZ2VC6PYIVQ5XLCZ3BP3SPHFTUKFNSQZVAWHS3N5BDLWDOAUK5VHNRP) |
| Registry | [`CAN2A7GA…AQ4H6RM`](https://stellar.expert/explorer/testnet/contract/CAN2A7GA2PNL4BYEBN3DZM3G74CNMJ2WAB2WTEMO4L6MIY5F2AQ4H6RM) |

## Documentation

- [Architecture](docs/architecture.md) — fund flow, trust model, contracts
- [Private policies](docs/private-policies-v2.md) — the policy model, proofs, and threat model
- [Development](docs/development.md) · [Operations](docs/operations.md)
- [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).

<!-- Updated documentation reference -->
