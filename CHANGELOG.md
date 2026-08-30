# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Breaking:** `AgentVault::release_payment` now requires a caller-supplied
  `step_id` between `task_id` and `asset`. Replays with the same
  `(task_id, step_id, amount)` are idempotent successes, while reusing a
  `step_id` with a different amount is rejected as `ReleaseConflict`.
- Repositioned the project around **private, policy-bounded delegation of money
  to AI agents**: a non-custodial CleverVault under a private, zero-knowledge-
  enforced spending policy. Updated `README.md`, `docs/architecture.md`, and
  `ROADMAP.md` to lead with this framing, with a clear line between what is live
  on testnet today (non-custodial vault + orchestration + agents) and the
  grant-scope roadmap (ZK policy enforcement, audit, mainnet).

### Added

- `@clevercon/agent-sdk` (`packages/agent-sdk`): shared scaffolding for
  specialist agents — `createAgent` wires the manifest, health, and paid task
  endpoints; x402 and MPP payment middleware factories (`withX402`, `withMpp`);
  self-registration with retry/backoff and heartbeat; graceful deregistration on
  SIGTERM; and a `reportFeedback` helper. Includes an example agent that
  reproduces `stellar-oracle` (parity-tested), a minimal MPP example, and a
  README quickstart. None of the five existing agents are changed.
- Roadmap for private spending policies: a spending rule the user sets and the
  vault enforces on-chain without revealing it, building on the zero-knowledge
  engine at [CipherMit](https://github.com/Bosun-Josh121/ciphermit).
- `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, and this
  changelog.
- `docs/architecture.md` and `docs/development.md`.
- GitHub issue templates (bug report, feature request, contributor issue) and
  a pull request template.
- CI workflows: TypeScript lint/typecheck/build/test and Rust
  fmt/clippy/test, with status badges in the README.
- Vitest unit tests for pure logic (registry reputation scoring and
  capability search; orchestrator agent selection and plan validation).
- Expanded inline documentation for the CleverVault contract's public entry
  points and the orchestrator/registry public APIs.

### Changed

- Restructured `README.md` into a standard open-source layout (overview,
  project structure, quick start, deployments) and moved detailed
  architecture diagrams into `docs/architecture.md`.

## [0.1.0] - 2026-04

### Added

- CleverVault Soroban contract (`contracts/agent-vault`): deposits,
  per-task budget locking, per-step payment release, task completion/
  cancellation, and stale-task recovery after 30 minutes.
- Orchestrator service (`packages/orchestrator`): Claude-based task planning,
  feasibility checking, agent selection/scoring, and a dependency-aware
  execution engine with x402 and MPP payment clients.
- Agent registry (`packages/registry`): self-registration, capability search,
  and an Elo-style reputation score updated from per-job feedback.
- Five specialist agents (`packages/agents/*`): `stellar-oracle`,
  `web-intel`, `web-intel-v2`, `analysis`, and `reporter`, paid via x402 or
  MPP.
- React dashboard (`packages/dashboard`) for wallet connection, vault
  funding, task submission and approval, and vault/task history.
- Render deployment blueprint (`render.yaml`, 7 services) and local
  development scripts (`scripts/start.sh`, `scripts/stop.sh`,
  `scripts/bootstrap.ts`, wallet setup scripts).

### Fixed

- Render build and deployment issues: missing build dependencies, dashboard
  build tooling placement, WebSocket protocol for production (`wss://`), and
  cold-start health-check timing.
- Orchestrator state persistence across redeploys, on-chain registration
  status surfacing in the UI, and propagation of failed-step context to
  downstream agents (so reports don't hallucinate missing data).

[Unreleased]: https://github.com/clevercon-protocol/clevercon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/clevercon-protocol/clevercon/releases/tag/v0.1.0
