# Contributing to CleverCon

Thanks for your interest in contributing to CleverCon, a way to delegate a
budget to AI agents on Stellar with funds held in a non-custodial vault. This
guide covers how to set up the project, the workflow we use, and what we look
for in a pull request.

## Ways to contribute

- **Bug reports**: open an issue with steps to reproduce.
- **Feature requests**: open an issue describing the use case before sending a
  large PR.
- **Code**: pick up an open issue (see [Finding something to work
  on](#finding-something-to-work-on)) and submit a PR.
- **Documentation**: fixes to setup steps, architecture docs, and inline code
  comments are always welcome.
- **Tests**: the project is actively growing its test suite. PRs that add
  coverage for existing logic are high value.
- **New agents and services**: register a specialist agent or service against
  the open registry. The agent interface is not tied to AI: any HTTP service
  with a Stellar wallet and x402 or MPP support can participate. See
  [docs/development.md](docs/development.md) for the interface.

## Project structure

```
clevercon/
├── contracts/             # Soroban smart contracts (Rust)
│   ├── agent-vault/        # CleverVault: non-custodial treasury + proof-gated release
│   ├── policy-verifier/    # on-chain verify_policy (private spending policies)
│   └── registry/           # on-chain service registration + reputation
├── circuits/spend-policy/  # Noir ZK circuit for private policies (proven in CI)
├── apps/web/               # the dApp (React 19 + Vite)
├── services/
│   ├── api/                # NestJS API (auth, tasks, policies, vault, admin, dev)
│   ├── indexer/            # on-chain event ingestion (balance mirror)
│   ├── workers/            # BullMQ: execution, proofs, exactly-once settlement
│   └── reference-provider/ # canonical hireable provider
├── packages/
│   ├── common/             # shared types, policy-input encoding, binding proof
│   ├── db/                 # Prisma schema + client, secret crypto
│   ├── agent-sdk/          # createSpender, createAgentWallet, createProvider, createAgent
│   ├── mcp/                # Stellar MCP server (12 tools)
│   └── dashboard/          # the public Vercel demo (contract-direct, no backend)
├── scripts/               # setup, wallet, and the E2E testnet harness
└── docs/                  # architecture, private-policies spec, development
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together
and [ROADMAP.md](ROADMAP.md) for where the project is headed.

## Development setup

### Prerequisites

- Node.js 20 (see `.nvmrc`) and npm
- For contract work: Rust, `cargo`, the `wasm32-unknown-unknown` target, and the
  [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

### Install and configure

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
npm install
cp .env.example .env
```

Start Postgres and Redis, then set up the database:

```bash
docker compose up -d postgres redis
npm run -w @clevercon/db generate && npm run -w @clevercon/db push
```

Set up the faucet/orchestrator wallet used to fund testnet flows:

```bash
npx tsx scripts/setup-wallets.ts        # generates keypairs; copy printed keys to .env
npx tsx scripts/add-usdc-trustlines.ts  # add USDC trustlines
npx tsx scripts/fund-testnet-usdc.ts    # swap XLM to USDC via the testnet DEX
```

### Running locally

Run each service in its own terminal:

```bash
npm run dev -w @clevercon/api        # API on :4100
npm run dev -w @clevercon/workers    # execution, proofs, settlement
npm run dev -w @clevercon/indexer    # on-chain event ingestion
npm run dev -w @clevercon/web        # dApp on :5173
```

The whole money loop can be exercised headlessly with `npx tsx scripts/e2e-testnet.ts`
(no browser). The public Vercel demo builds from `packages/dashboard` and needs no
backend. See [docs/development.md](docs/development.md) for the reference provider and
the full environment.

To seed the database with sample services and data:

```bash
npm run db:seed
```

## Common development tasks

```bash
npm run build          # build all backend services
npm run typecheck      # type-check every package
npm run lint           # lint TypeScript sources
npm run format         # format with Prettier
npm run format:check   # check formatting in CI
npm test               # run the Vitest unit test suite
```

For contract changes:

```bash
cd contracts/agent-vault
cargo fmt
cargo clippy
cargo test
```

To deploy a contract to testnet (requires a funded Stellar CLI identity):

```bash
cd contracts/agent-vault
./deploy.sh
```

## Coding standards

- **TypeScript**: strict mode, ESM (`NodeNext`). Run `npm run typecheck` and
  `npm run lint` before opening a PR.
- **Formatting**: run `npm run format`. CI checks formatting with
  `npm run format:check`.
- **Rust**: contract code should be `cargo fmt` clean and pass
  `cargo clippy -- -D warnings`.
- **Tests**: add or update Vitest tests for any pure logic you change
  (scoring, validation, reputation, plan parsing).
- **Commit messages**: this repo uses [Conventional
  Commits](https://www.conventionalcommits.org/):

  ```
  feat: add idempotency keys to the payments API
  fix: prevent duplicate task creation on vault timeout
  docs: document CleverVault authorization model
  test: add unit tests for settlement retry classification
  chore: bump @stellar/stellar-sdk to 14.x
  ```

  Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, or `build` as
  the type. Keep the summary line under about 72 characters and written in the
  imperative ("add", not "added" or "adds").

## Submitting changes

1. Fork the repo and create a branch off `main`
   (`feat/short-description`, `fix/short-description`).
2. Make your change, keeping the PR focused on a single concern.
3. Make sure `npm run lint`, `npm run typecheck`, `npm test`, and (if you
   touched a contract) `cargo test` all pass locally.
4. Fill out the [pull request
   template](.github/PULL_REQUEST_TEMPLATE.md) and link the issue you're
   addressing, if any.
5. A maintainer will review and may ask for changes before merging.

## Finding something to work on

Open issues are labeled by **package/area** (e.g. `agent-vault`,
`api`, `agent-sdk`, `mcp`), **difficulty** (`good first issue`,
`medium`, `hard`), and **roadmap area**. Issues that fund a bounty through
[GrantFox](https://grantfox.xyz) are labeled `bounty` with the amount in the
issue body.

Priority is on: private spending policies in CleverVault (the headline next
step), hardening the CleverVault contract, an on-chain agent registry, a Stellar
MCP server, and the specialist agent SDK. See [ROADMAP.md](ROADMAP.md). Beyond
those, building and registering new specialist services is a great path: your
service can be LLM-powered, an API gateway, a computation service, a
verification service, or anything else that exposes an HTTP endpoint and supports
x402 or MPP payment.

## Getting help

If you're stuck, open an issue with the `question` label, or email the
maintainer at joshuaibitoye111@gmail.com.
