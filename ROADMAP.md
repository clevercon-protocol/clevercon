# Roadmap

## Vision

CleverCon is the **marketplace and orchestration layer for AI agents on
Stellar**: it lets agents discover each other, negotiate work via capability
matching and reputation, and settle payment per task step in USDC — with funds
held in a trustless on-chain vault rather than by an operator.

CleverCon is deliberately scoped to orchestration and marketplace mechanics —
planning, agent discovery, reputation, and payment settlement. Identity and
authorization for agents (who is allowed to act on whose behalf, and under
what delegated permissions) is the concern of complementary protocols such as
REAPP. CleverCon integrates with that layer rather than re-implementing it.

Four components are critical to taking CleverCon from a testnet demo to
production-ready infrastructure:

1. A **hardened CleverVault contract** — the on-chain USDC treasury.
2. An **on-chain Agent Registry contract** — replacing the current off-chain
   JSON-backed registry with a Soroban contract for agent manifests and
   reputation.
3. A **Stellar MCP server** — exposing registry and vault data as MCP tools so
   any MCP-compatible AI client can discover and pay CleverCon agents.
4. A **specialist Agent SDK** (`@clevercon/agent-sdk`) — a package that
   packages up the x402/MPP server scaffolding, self-registration, and
   health/manifest endpoints that every specialist agent currently
   reimplements.

The phases below build toward those four components. Issues in this repo are
labeled with the phase they belong to.

## Current status — testnet MVP

The following is live and working on Stellar Testnet today:

- CleverVault Soroban contract deployed, handling deposits, per-task budget
  locking, per-step payment release, and refunds of unused budget.
- Orchestrator service: Claude-based task planning, feasibility checking,
  agent selection/scoring, and a dependency-aware execution engine.
- Off-chain agent registry (Express + JSON file) with self-registration,
  capability search, and an Elo-style reputation score updated after every
  job.
- Five specialist agents (`stellar-oracle`, `web-intel`, `web-intel-v2`,
  `analysis`, `reporter`) paid via x402 or MPP.
- React dashboard for connecting a wallet, funding the vault, submitting
  tasks, approving plans, and viewing vault/task history.
- One-command local dev (`scripts/start.sh`) and a 7-service Render
  deployment blueprint (`render.yaml`).

What's missing for production readiness is what the phases below address —
most notably, the CleverVault contract has no automated test suite yet, the
registry and agent scaffolding are not yet packaged as reusable on-chain or
SDK components, and several internal secrets (e.g. orchestrator keys) are
stored in plaintext on disk.

## Phase 1 — Harden CleverVault

- Add an automated test suite for `contracts/agent-vault` covering deposits,
  task lifecycle, stale-task recovery, and authorization checks
  (`soroban-sdk` testutils are already a dev-dependency).
- Add storage TTL / `extend_ttl` management for persistent ledger entries.
- Evaluate and design multi-asset support (today the vault is hardcoded to a
  single USDC SAC).
- Expand inline documentation (parameters, return values, panics,
  authorization requirements) to make the contract review-ready.
- Address known hardening gaps: encrypt orchestrator secret keys at rest,
  add file-locking/atomic writes to the JSON-backed stores.

## Phase 2 — On-chain Agent Registry contract

- Design a Soroban contract that mirrors `packages/registry`'s data model
  (`AgentManifest`, reputation fields) for on-chain storage.
- Migrate agent registration, discovery, and feedback-driven reputation
  updates to read from and write to the contract, with the existing Express
  registry as a caching/indexing layer in front of it.
- Define the migration path for existing off-chain registry data.

## Phase 3 — Stellar MCP server & Specialist Agent SDK

- Build a Stellar MCP server that exposes agent discovery (registry reads),
  vault balance/task views, and payment helpers as MCP tools, so any
  MCP-compatible AI client can find and pay CleverCon agents.
- Extract `@clevercon/agent-sdk`: shared scaffolding for specialist agents —
  x402/MPP server setup, manifest/health endpoints, self-registration with
  retry, and reputation feedback helpers — based on the patterns duplicated
  across the five existing agents.
- Port the existing agents to the SDK as the reference implementation.

## Phase 4 — Ecosystem & multi-provider

- Abstract the planner, feasibility checker, and rating logic behind a
  provider interface so models beyond Anthropic's Claude can be used.
- Add retry/backoff consistently across payment clients (MPP currently lacks
  the retry logic that x402 has) and external data sources (Horizon, scraper).
- Add structured logging/correlation IDs across the orchestrator and agents
  for observability.
- Grow the specialist agent catalog with community-contributed agents built
  on the Agent SDK.

## Phase 5 — Mainnet

- Security review / audit of CleverVault and the Agent Registry contract.
- Deploy CleverVault and the Agent Registry contract to Stellar mainnet.
- Production deployment hardening (secrets management, monitoring, rate
  limiting) across the registry, orchestrator, and agents.
- Mainnet USDC and multi-asset support per the design from Phase 1.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
for current bounties, and [CONTRIBUTING.md](CONTRIBUTING.md) for how to get
started.
