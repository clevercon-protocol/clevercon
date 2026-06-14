# Contributing to CleverCon

Thanks for your interest in contributing to CleverCon — an open marketplace and
orchestration layer for AI agents on Stellar. This guide covers how to set up
the project, the workflow we use, and what we look for in a pull request.

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce.
- **Feature requests** — open an issue describing the use case before sending a
  large PR.
- **Code** — pick up an open issue (see [Finding something to work
  on](#finding-something-to-work-on)) and submit a PR.
- **Documentation** — fixes to setup steps, architecture docs, and inline code
  comments are always welcome.
- **Tests** — the project is actively growing its test suite; PRs that add
  coverage for existing logic are high value.

## Project structure

```
clevercon/
├── contracts/             # Soroban smart contracts (Rust)
│   ├── agent-vault/        # CleverVault — on-chain treasury for tasks
│   └── budget-guardian/     # earlier budget-tracking contract (legacy)
├── packages/
│   ├── common/             # shared types, constants, wallet helpers
│   ├── registry/           # agent discovery + reputation API
│   ├── orchestrator/        # task planning, execution, vault integration
│   ├── dashboard/           # React frontend (not a current priority area)
│   └── agents/              # specialist agents (stellar-oracle, web-intel,
│                              web-intel-v2, analysis, reporter)
├── scripts/                # setup, wallet, and lifecycle scripts
└── docs/                   # architecture and development docs
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit
together and [ROADMAP.md](ROADMAP.md) for where the project is headed.

## Development setup

### Prerequisites

- Node.js 20 (see `.nvmrc`) and npm
- For contract work: Rust, `cargo`, the `wasm32-unknown-unknown` target, and
  the [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

### Install and configure

```bash
git clone https://github.com/clevercon-protocol/clevercon.git
cd clevercon
npm install
cp .env.example .env
```

Generate and fund Stellar testnet wallets for the orchestrator and each agent:

```bash
npx tsx scripts/setup-wallets.ts
npx tsx scripts/add-usdc-trustlines.ts
npx tsx scripts/distribute-usdc.ts
```

### Running locally

```bash
./scripts/start.sh   # builds the dashboard and starts registry, orchestrator,
                      # and all agents with health checks
./scripts/stop.sh    # stops everything started above
```

Or run services individually during development:

```bash
npm run dev              # all services concurrently
npm run dev:registry      # just the registry
npm run dev:orchestrator  # just the orchestrator
npm run dev:oracle        # etc. — see package.json for the full list
```

To seed some demo task history (useful for testing reputation scoring and the
dashboard):

```bash
npx tsx scripts/bootstrap.ts --auto-approve
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
- **Formatting**: run `npm run format` — CI checks formatting with
  `npm run format:check`.
- **Rust**: contract code should be `cargo fmt` clean and pass
  `cargo clippy -- -D warnings`.
- **Tests**: add or update Vitest tests for any pure logic you change
  (scoring, validation, reputation, plan parsing, etc.).
- **Commit messages**: this repo uses [Conventional
  Commits](https://www.conventionalcommits.org/):

  ```
  feat: add retry/backoff to MPP client
  fix: prevent duplicate task creation on vault timeout
  docs: document CleverVault authorization model
  test: add unit tests for registry reputation scoring
  chore: bump @stellar/stellar-sdk to 14.x
  ```

  Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, or `build` as
  the type. Keep the summary line under ~72 characters and written in the
  imperative ("add", not "added" or "adds").

## Submitting changes

1. Fork the repo and create a branch off `main`
   (`feat/short-description`, `fix/short-description`, etc.).
2. Make your change, keeping the PR focused on a single concern.
3. Make sure `npm run lint`, `npm run typecheck`, `npm test`, and (if you
   touched a contract) `cargo test` all pass locally.
4. Fill out the [pull request
   template](.github/PULL_REQUEST_TEMPLATE.md) — link the issue you're
   addressing, if any.
5. A maintainer will review and may ask for changes before merging.

## Finding something to work on

Open issues are labeled by **package/area** (e.g. `agent-vault`,
`orchestrator`, `registry`, `agent-sdk`), **difficulty** (`good first issue`,
`medium`, `hard`), and **roadmap phase**. Issues that fund a bounty through
[GrantFox](https://grantfox.xyz) are labeled `bounty` with the amount noted in
the issue body.

Priority is currently on the four components that will move CleverCon toward
mainnet: the CleverVault contract, an on-chain Agent Registry contract, a
Stellar MCP server, and the specialist Agent SDK. See
[ROADMAP.md](ROADMAP.md) for details — issues touching these areas are a great
place to start.

## Getting help

If you're stuck, open an issue with the `question` label, or email the
maintainer at joshuaibitoye111@gmail.com.
