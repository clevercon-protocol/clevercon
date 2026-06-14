# Security Policy

## Pre-production status

CleverCon currently runs on **Stellar Testnet**. Contracts, wallets, and
funds involved are all testnet assets with no real-world value. That said, we
treat security issues seriously even at this stage, since the CleverVault
contract design and orchestration logic are the foundation for a future
mainnet deployment.

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately by
emailing **joshuaibitoye111@gmail.com**. Do not open a public GitHub issue for
security reports.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, including any relevant transaction hashes, contract
  IDs, or request payloads (testnet only — do not send real secret keys).
- The affected package or contract (e.g. `contracts/agent-vault`,
  `packages/orchestrator`).

### What to expect

- **Acknowledgement within 48 hours** of your report.
- **Initial triage within 5 business days**, including a severity assessment
  and, where applicable, a plan and rough timeline for a fix.
- We'll keep you updated as a fix is developed and let you know when it has
  shipped. Credit is offered to reporters who wish to be named, once a fix is
  released.

## Scope

In scope:

- `contracts/agent-vault` (CleverVault) and `contracts/budget-guardian` —
  fund-handling logic, authorization checks, and state transitions.
- `packages/orchestrator`, `packages/registry`, and `packages/common` —
  payment construction/signing, vault interaction, and data persisted to disk
  (e.g. wallet secrets in `packages/orchestrator/src/orchestrator-store.ts`).
- `packages/agents/*` — payment verification on specialist agent endpoints.
- `scripts/*` and CI/deployment configuration (`render.yaml`,
  `.github/workflows/*`).

Out of scope:

- `packages/dashboard` (the React frontend) and general UI/UX issues — please
  still report these, but they are a lower priority during the current
  backend-hardening phase.
- Third-party services CleverCon depends on (Stellar network itself, the
  x402 facilitator, Anthropic's API, Render) — report these to their
  respective maintainers.
- Issues that require a compromised local environment or physical access to a
  user's machine.

## Known limitations

A few hardening gaps are already tracked as open issues rather than hidden:

- Orchestrator secret keys are currently stored in plaintext in
  `data/orchestrators.json` (flagged in source as a pre-production shortcut).
- The registry's JSON file store has no write locking, so concurrent writes
  can race.

If you find additional issues along these lines, please still report them —
duplicates help us prioritize.
