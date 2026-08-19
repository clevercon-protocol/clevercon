# Roadmap

## Vision

CleverCon is a way to delegate a budget to AI agents on Stellar without giving
up custody. Funds sit in a non-custodial Soroban vault, an orchestrator hires
agents by capability, and payment settles in USDC per task step. The vault caps
what can be spent and refunds the rest.

The current agent network is AI-focused, but the protocol is not tied to AI. Any
HTTP service with a Stellar wallet and x402 or MPP support can register.

The direction the project is heading is private spending policies: the user sets
a spending rule (a cap, an allowlist of payees, a per-payment limit), the vault
enforces it on every release, and the rule itself stays private. This turns
"the operator cannot overspend the budget" into "the delegate cannot spend
outside the rule you set, and the rule is not public."

## Current status

Live on Stellar Testnet today:

- **CleverVault** Soroban contract: deposits, per-task budget locking, per-step
  release capped on-chain, refunds of unused budget, multi-asset support,
  stale-task recovery, and pause/admin controls, with a 100+ case test suite.
- **Orchestrator**: task planning (Claude Sonnet), feasibility checks, agent
  selection and scoring, and a dependency-aware execution engine.
- **Agent registry**: self-registration, capability search, and a reputation
  score updated after every job.
- **Five specialist agents** (`stellar-oracle`, `web-intel`, `web-intel-v2`,
  `analysis`, `reporter`) paid over x402 or MPP.
- **React dashboard** for connecting a wallet, funding the vault, submitting and
  approving tasks, and viewing history.
- One-command local dev (`scripts/start.sh`) and a 7-service Render blueprint.

Known gaps: the vault does not yet enforce spending policies, the registry and
agent scaffolding are not packaged for reuse, the planner is hardcoded to
Anthropic, and orchestrator keys are stored in plaintext on disk.

## Private spending policies

The headline next step. A user commits a spending rule when they lock funds, and
the vault checks every release against it.

- Support four rule types: a rolling spend cap over a time window, an allowlist
  of approved payees, per-delegate sub-budgets, and a deny-list with thresholds.
- Keep the rule private by committing it as a hash and proving compliance with a
  zero-knowledge proof rather than storing the rule in the clear.
- Verify the proof on-chain before funds move, binding it to the specific payee
  and amount, with replay protection.
- Prove compliance when the budget is locked, then allow fast per-step releases
  within the proven envelope, so per-call payments stay instant.

The zero-knowledge engine for this already runs on testnet as a separate
project, [CipherMit](https://github.com/Bosun-Josh121/ciphermit). Bringing it
into CleverVault is the main build.

## Harden CleverVault

- Extend the test suite to cover the policy-verification path end to end.
- Add storage TTL management for persistent entries.
- Encrypt orchestrator secret keys at rest and add file-locking to the
  JSON-backed stores.
- Expand inline documentation so the contract is review-ready.

## On-chain agent registry

- A Soroban contract mirroring the registry's data model, so manifests and
  reputation are verifiable on-chain rather than living in one service's JSON
  file.
- Migrate registration, discovery, and feedback to the contract, with the
  Express registry as a cache.

## Stellar MCP server and agent SDK

- An MCP server exposing agent discovery, vault views, and payment helpers as
  MCP tools, so any MCP-compatible client can find and pay CleverCon agents.
- `@clevercon/agent-sdk`: shared scaffolding for specialist agents (x402/MPP
  setup, manifest and health endpoints, self-registration, feedback helpers),
  extracted from the patterns duplicated across the five existing agents.

## Multi-provider and ecosystem

- Decouple the planner from the Anthropic SDK behind a provider interface
  (Claude, GPT, Gemini, local models, and a mock for development), selected with
  `LLM_PROVIDER`.
- Add retry and backoff consistently across payment clients and data sources.
- Add structured logging and correlation IDs across services.

## Audit and mainnet

- Security review of CleverVault, including the policy-verification path.
- Move proving toward a local or enclave prover so users need not trust a hosted
  prover.
- Deploy to Stellar mainnet with mainnet USDC and multi-asset support.
- Production hardening: secrets management, monitoring, and rate limiting.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
and [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
