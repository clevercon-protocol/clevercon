# Roadmap

## Vision

CleverCon is a marketplace and orchestration layer on Stellar where services
discover each other by capability, get hired through Soroban smart contracts,
and settle payment in USDC per task step. The current agent network is
AI-focused, but the protocol is service-agnostic: any HTTP service with a
Stellar wallet and x402 or MPP support can register. Future participants may
include data oracles, computation services, paid APIs, verification services,
and human-in-the-loop workers.

CleverCon is scoped to orchestration and marketplace mechanics: planning, agent
discovery, reputation, and payment settlement. Identity and authorization for
agents (who is allowed to act on whose behalf, under what delegated permissions)
is the concern of complementary protocols such as REAPP. CleverCon integrates
with that layer rather than re-implementing it.

Four components are critical to moving CleverCon from testnet demo to
production-ready infrastructure:

1. A **hardened CleverVault contract** - the on-chain USDC treasury.
2. An **on-chain Agent Registry contract** - replacing the current off-chain
   JSON-backed registry with a Soroban contract for agent manifests and
   reputation.
3. A **Stellar MCP server** - exposing registry and vault data as MCP tools so
   any MCP-compatible client can discover and pay CleverCon agents.
4. A **specialist Agent SDK** (`@clevercon/agent-sdk`) - a package that bundles
   the x402/MPP server scaffolding, self-registration, and health/manifest
   endpoints that every specialist agent currently reimplements separately.

## Current status

The following is live and working on Stellar Testnet today:

- CleverVault Soroban contract: deposits, per-task budget locking, per-step
  payment release, and refunds of unused budget.
- Orchestrator service: LLM-driven task planning (currently Claude Sonnet),
  feasibility checking, agent selection/scoring, and a dependency-aware
  execution engine.
- Off-chain agent registry (Express + JSON file) with self-registration,
  capability search, and an Elo-style reputation score updated after every job.
- Five specialist agents (`stellar-oracle`, `web-intel`, `web-intel-v2`,
  `analysis`, `reporter`) paid via x402 or MPP.
- React dashboard for connecting a wallet, funding the vault, submitting tasks,
  approving plans, and viewing vault/task history.
- One-command local dev (`scripts/start.sh`) and a 7-service Render deployment
  blueprint (`render.yaml`).

What's missing for production: the vault has no automated test suite yet, the
registry and agent scaffolding are not packaged as reusable components, the
orchestrator's LLM provider is hardcoded to Anthropic, and orchestrator keys
are stored in plaintext on disk.

## Phase 1 - Harden CleverVault

- Add an automated test suite covering deposits, task lifecycle, stale-task
  recovery, and authorization checks (`soroban-sdk` testutils are already a
  dev-dependency).
- Add storage TTL / `extend_ttl` management for persistent ledger entries.
- Evaluate and design multi-asset support (today the vault is hardcoded to a
  single USDC SAC).
- Expand inline documentation (parameters, return values, panics, authorization
  requirements) to make the contract review-ready.
- Known hardening gaps: encrypt orchestrator secret keys at rest; add
  file-locking and atomic writes to the JSON-backed stores.

## Phase 2 - On-chain Agent Registry contract

- Design a Soroban contract that mirrors `packages/registry`'s data model
  (`AgentManifest`, reputation fields) for on-chain storage.
- Migrate agent registration, discovery, and feedback-driven reputation updates
  to read from and write to the contract, with the existing Express registry as
  a caching layer.
- Define the migration path for existing off-chain registry data.

## Phase 3 - Stellar MCP server + Specialist Agent SDK

- Build a Stellar MCP server that exposes agent discovery, vault balance/task
  views, and payment helpers as MCP tools, so any MCP-compatible client can
  find and pay CleverCon agents.
- Extract `@clevercon/agent-sdk`: shared scaffolding for specialist agents -
  x402/MPP server setup, manifest/health endpoints, self-registration with
  retry, and reputation feedback helpers - based on the patterns duplicated
  across the five existing agents.
- Port the existing agents to the SDK as the reference implementation.

## Phase 4 - Multi-provider + ecosystem

- Decouple the orchestrator from the Anthropic SDK behind a pluggable LLM
  provider interface. The interface should allow swapping between Claude,
  GPT-4, Gemini, local models, and a mock provider for development without
  API keys.
- Multi-provider configuration via environment variable
  (`LLM_PROVIDER=anthropic|openai|google|mock`).
- Apply the same abstraction to the registry's quality rating service
  (currently hardcoded to Claude Haiku).
- Add retry/backoff consistently across payment clients (MPP currently lacks
  the retry logic that x402 has) and external data sources (Horizon, scraper).
- Add structured logging/correlation IDs across the orchestrator and agents
  for observability.
- Grow the specialist agent catalog with community-contributed agents and
  services built on the Agent SDK.

## Phase 5 - Mainnet

- Security review and audit of CleverVault and the Agent Registry contract.
- Deploy CleverVault and the Agent Registry contract to Stellar mainnet.
- Production deployment hardening: secrets management, monitoring, rate
  limiting across the registry, orchestrator, and agents.
- Mainnet USDC and multi-asset support per the design from Phase 1.

## Long-term

- **Beyond AI agents:** onboard non-AI services (oracles, computation,
  verification, human-in-the-loop) as first-class marketplace participants.
  The agent interface is already service-agnostic; the work is SDK support
  and documentation.
- **Multi-orchestrator support:** allow third parties to run their own
  orchestrators against the shared registry, removing the single-operator
  centralization point. Users choose which orchestrator to use based on track
  record, fee, or features.
- **Community-driven reputation:** move quality rating away from any single
  LLM provider toward multi-provider consensus or user-driven ratings weighted
  by on-chain history.
- **Service-agnostic developer tooling:** packaging patterns and SDK support
  for building any type of specialist service, not just LLM-powered agents.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
for current bounties, and [CONTRIBUTING.md](CONTRIBUTING.md) for how to get
started.
