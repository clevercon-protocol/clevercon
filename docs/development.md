# Development Guide

This guide covers day-to-day development on CleverCon: setup, common tasks,
testing, linting, CI, deployment, and debugging. For a high-level tour of the
system, see [architecture.md](architecture.md). For the contribution
workflow (branches, commit style, PR process), see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Repo structure

```
clevercon/
├── contracts/agent-vault/     CleverVault Soroban contract (Rust)
├── contracts/budget-guardian/ legacy contract, not used by the orchestrator
├── packages/common/            shared types, constants, wallet helpers
├── packages/registry/          agent discovery + reputation API
├── packages/orchestrator/      planner, executor, vault client, WS hub
├── packages/dashboard/         React frontend (not a priority for backend work)
├── packages/agents/*/          five specialist agents
├── scripts/                     setup, lifecycle, and seeding scripts
└── docs/                         this guide + architecture.md
```

## Setup

1. Install Node.js 20 (see `.nvmrc`) and run `npm install` from the repo
   root — this installs all workspace packages.
2. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Most other
   variables are filled in by the scripts below.
3. Generate Stellar testnet wallets:

   ```bash
   npx tsx scripts/setup-wallets.ts
   ```

   This creates `wallets.json` (gitignored) and **prints the secret keys to
   stdout**. Copy the printed `*_SECRET_KEY=S...` lines into your `.env` file
   before continuing — the services refuse to start without them.

4. Add USDC trustlines to every wallet:

   ```bash
   npx tsx scripts/add-usdc-trustlines.ts
   ```

5. Fund the **orchestrator** with testnet USDC. Open
   [https://faucet.circle.com](https://faucet.circle.com), select
   **Stellar Testnet**, and paste the orchestrator's public key (shown in the
   `setup-wallets.ts` output). Click the faucet button **2-3 times** (each
   gives 10 USDC; the orchestrator needs ~15 USDC to distribute to agents and
   cover task payments).

6. Distribute USDC from the orchestrator to each agent wallet:

   ```bash
   npx tsx scripts/distribute-usdc.ts
   ```

7. (Optional) Deploy CleverVault to your own testnet contract:

   ```bash
   cd contracts/agent-vault && ./deploy.sh
   ```

   This writes `AGENT_VAULT_CONTRACT_ID` to `.env`. If unset, the
   orchestrator's vault client (`agent-vault-client.ts`) detects that the
   vault is inactive (`VAULT_ACTIVE = false`) and all vault calls become safe
   no-ops — useful for working on non-vault code without a deployed contract.

## Running services

```bash
./scripts/start.sh    # build dashboard, start registry + 5 agents + orchestrator
./scripts/stop.sh     # stop everything start.sh started
```

`start.sh` writes each service's stdout/stderr to `logs/<service>.log` and its
PID to `logs/<service>.pid` (both gitignored). Tail a log while debugging:

```bash
tail -f logs/orchestrator.log
```

For tighter iteration on a single service, run it directly:

```bash
npm run dev:registry
npm run dev:orchestrator
npm run dev:oracle       # stellar-oracle agent
npm run dev:webintel      # web-intel agent
npm run dev:webintel2     # web-intel-v2 agent
npm run dev:analysis
npm run dev:reporter
```

Or all of them concurrently with `npm run dev`.

### Seeding data

```bash
npx tsx scripts/bootstrap.ts --auto-approve
```

Runs ~25 varied tasks through the orchestrator so agents accumulate
reputation history — useful when working on the selector or dashboard.

## Common tasks

```bash
npm run build       # build all backend services (esbuild) + dashboard
npm run typecheck   # tsc --noEmit across every workspace package
npm run lint        # ESLint over all TypeScript sources
npm run format      # Prettier --write
npm run format:check  # Prettier --check (used in CI)
npm test            # Vitest unit tests
```

Build a single service with `npm run build:<name>` (e.g. `build:orchestrator`,
`build:oracle`) — see `package.json` for the full list. Each maps to an
esbuild invocation that bundles the service into `packages/<pkg>/dist/`.

## Testing

Unit tests use [Vitest](https://vitest.dev/) and are colocated with the code
they test as `*.test.ts`. Current coverage focuses on pure logic that's easy
to verify in isolation:

- `packages/registry/src/reputation.test.ts` — reputation score calculation
  and rolling-average updates.
- `packages/registry/src/search.test.ts` — capability matching.
- `packages/orchestrator/src/selector.test.ts` — agent scoring/selection.
- `packages/orchestrator/src/validator.test.ts` — execution plan validation.

Run the full suite with `npm test`, or scope to a package with
`npm test -w packages/registry`.

### Contract tests

```bash
cd contracts/agent-vault
cargo test     # uses soroban-sdk testutils
cargo fmt
cargo clippy -- -D warnings
```

## Linting and formatting

ESLint (TypeScript) and Prettier are configured at the repo root and apply to
every workspace package except `packages/dashboard` (which has its own
frontend tooling and is out of scope for backend hardening). Run
`npm run lint` and `npm run format:check` before opening a PR — CI runs both.

## CI overview

Two workflows run on pull requests and pushes to `main`:

- **`.github/workflows/ci.yml`** — a TypeScript job (`npm ci`, `typecheck`,
  `lint`, `format:check`, `build`, `test`) and a Rust job (`cargo fmt --check`,
  `cargo clippy`, `cargo test` for each contract).
- **`.github/workflows/dependency-review.yml`** — flags newly introduced
  dependencies with known vulnerabilities on pull requests.

## Deployment

`render.yaml` defines all 7 services (registry, orchestrator+dashboard, and
the 5 agents) as a Render Blueprint. To deploy:

1. Push to GitHub and create a Blueprint from this repo in Render.
2. Set the `sync: false` secrets (`*_SECRET_KEY`, `ANTHROPIC_API_KEY`,
   `AGENT_VAULT_CONTRACT_ID`) in the Render dashboard for each service.
3. After the first deploy, update `REGISTRY_URL` and each `*_SELF_URL` env
   var to the assigned `*.onrender.com` URLs, then redeploy — agents
   re-register themselves with the registry on startup.

Render's free tier cold-starts services after inactivity; the orchestrator's
executor (`checkHealth` in `executor.ts`) retries health checks for up to ~90
seconds to accommodate this.

## Common pitfalls

- **Agents can't reach the registry on startup.** Each agent's `register.ts`
  self-registers once at boot with no retry — if the registry isn't up yet,
  the agent won't appear until it's restarted or re-registers via its
  heartbeat. `start.sh` starts the registry first and waits for its health
  check for this reason.
- **Stellar sequence number errors during execution.** `release_payment`
  calls for a task must be submitted in order — `executor.ts`'s
  `releaseSequential` serializes them. If you're calling
  `agent-vault-client.ts` functions directly (e.g. from a script), don't fire
  multiple orchestrator-signed transactions concurrently.
- **Vault calls silently no-op.** If `AGENT_VAULT_CONTRACT_ID` is unset or
  looks like a placeholder, `VAULT_ACTIVE` is `false` and
  `agent-vault-client.ts` returns safe defaults instead of calling the
  contract. Useful for local dev, but confusing if you're expecting on-chain
  state to change.
- **`data/` and `logs/` are gitignored and created at runtime.** If you
  `rm -rf data/`, the registry, vault ledger, activity log, and task history
  all reset. Don't commit anything from `data/` — it includes orchestrator
  wallet secret keys (see [SECURITY.md](../SECURITY.md)).
- **`tsc -b` project references.** Each workspace package has its own
  `tsconfig.json` extending the root config; `npm run typecheck` runs `tsc
  --noEmit` per package rather than relying on a single project-reference
  build.

## Debugging

- **Service logs**: `logs/<service>.log` when started via `start.sh`.
- **On-chain state**: use the read-only helpers in
  `packages/orchestrator/src/agent-vault-client.ts` (`getBalance`,
  `getAvailable`, `getAccount`, `get_task` via `getTask`-style calls) or query
  directly with the Stellar CLI / `stellar.expert` testnet explorer using the
  contract ID and account addresses from `.env`.
- **WebSocket events**: the orchestrator emits a typed event stream
  (`task_started`, `step_started`, `step_complete`, `step_failed`,
  `budget_released`, `task_complete`) over `/ws` — connect with `wscat` or the
  dashboard's network tab to watch a task execute in real time.
- **Vault ledger / activity log / task results**: inspect
  `data/vault-ledger.json`, `data/activity-log.json`, and
  `data/task-results.json` directly for a record of what the orchestrator has
  done.

## Getting help

Open an issue (use the bug report or contributor issue template), or email
the maintainer at joshuaibitoye111@gmail.com for anything sensitive — see
[SECURITY.md](../SECURITY.md) for vulnerability reports specifically.
