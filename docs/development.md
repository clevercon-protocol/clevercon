# Development guide

How to run and work on the CleverCon production stack locally. For how the pieces
fit together see [architecture.md](architecture.md); for the repo layout and
contribution flow see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- **Node.js 20+** (see `.nvmrc`) and npm.
- **Docker** for PostgreSQL and Redis (or your own instances).
- **A Stellar wallet** (Freighter) set to testnet, for the dApp.
- For contract work: **Rust + cargo** with the `wasm32-unknown-unknown` target and
  the [Stellar CLI](https://developers.stellar.org/docs/tools/cli).
- For the ZK circuit: `nargo` + `bb` (see [circuits/spend-policy/README.md](../circuits/spend-policy/README.md)).

## Install and configure

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
cp .env.example .env      # then fill in the values
npm install
```

`.env` is the single source of truth for configuration; `services/api/src/config/env.validation.ts`
is the authoritative schema (it validates on boot). The variables you most need set:

- `DATABASE_URL`, `REDIS_URL` — Postgres and Redis.
- `JWT_SECRET`, `DELEGATE_ENCRYPTION_KEY` — auth signing and the AES-256-GCM key that
  encrypts each user's delegate secret at rest.
- `AGENT_VAULT_CONTRACT_ID`, `POLICY_VERIFIER_CONTRACT_ID`, `USDC_SAC`, `STELLAR_RPC_URL`,
  `NETWORK_PASSPHRASE` — the deployed testnet contracts and chain access (defaults point
  at the deployed testnet addresses).
- `ANTHROPIC_API_KEY` (or `AGENT_PROVIDER` + an OpenAI-compatible key) — the chat agent's
  planner; a deterministic fallback runs without a key.
- `CORS_ORIGINS` — comma-separated browser origins allowed in production (any origin is
  reflected when unset, for local dev).

The faucet/orchestrator wallet (in `wallets.json`) funds testnet flows; generate and
stock it with:

```bash
npx tsx scripts/setup-wallets.ts        # generate keypairs; copy printed keys to .env
npx tsx scripts/add-usdc-trustlines.ts  # add USDC trustlines
npx tsx scripts/fund-testnet-usdc.ts    # swap XLM -> USDC on the testnet DEX
```

## Database

```bash
docker compose up -d postgres redis
npm run -w @clevercon/db generate       # generate the Prisma client
npm run -w @clevercon/db push           # apply the schema (schema-push repo; no migrations dir)
npm run db:seed                         # optional: sample services + data
```

The schema lives in `packages/db/prisma/schema.prisma`. This repo is schema-push
based: `schema.prisma` is the source of truth and `db push` applies it.

## Running the stack

Run each service in its own terminal:

```bash
npm run dev -w @clevercon/api        # NestJS API on :4100
npm run dev -w @clevercon/workers    # BullMQ: execution, proofs, settlement
npm run dev -w @clevercon/indexer    # on-chain event ingestion + balance mirror
npm run dev -w @clevercon/web        # the dApp (Vite) on :5173
```

The dApp defaults to demo mode; for the live local stack set `apps/web/.env.local`
with `VITE_BACKEND=full`, `VITE_NETWORK=testnet`, `VITE_API_URL=http://localhost:4100`.

Optional: run the reference provider so hires have a live endpoint to fulfill:

```bash
npm run dev -w @clevercon/reference-provider   # a canonical provider on :4200
```

## The end-to-end harness

The whole money loop is exercised headlessly (fresh keypair, no browser) by:

```bash
npx tsx scripts/e2e-testnet.ts
```

It drives: friendbot fund -> USDC trustline -> faucet -> SEP-10 sign-in -> deposit ->
mirror -> authorize delegate -> policy -> pay -> disburse -> webhook -> idempotency ->
concurrent spends -> hire -> SDK + MCP spends -> x402 agent-key top-up + external
payment -> withdraw -> reclaim. Every stage is a real on-chain settlement. Env:
`API_URL` (default `http://localhost:4100`), `E2E_SKIP_HIRE=1`, `E2E_SKIP_X402=1`.

## Testing and quality gates

These are the same gates CI runs:

```bash
npm run typecheck      # tsc --noEmit across all packages/services
npm run lint           # eslint
npm run format:check   # prettier (run `npm run format` to fix)
npm test               # vitest across the workspace
npm run build          # build the dashboard + web app
```

Unit tests use mocked Prisma/fetch and need no services. Integration tests
(`*.integration.test.ts`) run only when `TEST_DATABASE_URL` is set, and they wipe
data, so point them at an **isolated** schema (a `cctest` schema), never the app's
`clevercon` schema.

For contracts: `cargo test` in `contracts/agent-vault` or `contracts/policy-verifier`.

## Being a paid service

To offer a service the hire flow can pay, or run your own x402/MPP paywall, use the
SDK's `createProvider` / `createAgent`. See
[packages/agent-sdk/README.md](../packages/agent-sdk/README.md); `services/reference-provider`
is a live example built on `createProvider`.
