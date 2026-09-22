# Security Policy

## Pre-production status

CleverCon currently runs on **Stellar Testnet**. Contracts, wallets, and funds
involved are all testnet assets with no real-world value. Even so, we treat
security issues seriously, since the CleverVault contract, the PolicyVerifier, and
the non-custodial delegate + settlement path are the foundation for a future
mainnet deployment.

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately by emailing
**joshuaibitoye111@gmail.com**. Do not open a public GitHub issue for security
reports.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, including any relevant transaction hashes, contract IDs,
  or request payloads (testnet only; do not send real secret keys).
- The affected package or contract (e.g. `contracts/agent-vault`,
  `services/api`).

### What to expect

- **Acknowledgement within 48 hours** of your report.
- **Initial triage within 5 business days**, including a severity assessment
  and, where applicable, a plan and rough timeline for a fix.
- We keep you updated as a fix is developed and let you know when it ships.
  Credit is offered to reporters who wish to be named once a fix is released.

## Scope

In scope:

- `contracts/agent-vault` (CleverVault), `contracts/policy-verifier`, and
  `contracts/registry`: fund-handling logic, authorization checks, the proof-gated
  release + verifier cross-call, and state transitions.
- `services/api`, `services/workers`, `services/indexer`, and `packages/{common,db}`:
  SEP-10/JWT auth, scoped API keys, step-up auth, the delegate that signs
  vault calls, the settlement path, and how the delegate secret is stored
  (AES-256-GCM encrypted in Postgres).
- `packages/agent-sdk` and `packages/mcp`: the spending surfaces and how a scoped
  API key is bounded by policy.
- The private spending-policy layer (proof verification, policy commitments, and
  replay/nullifier handling), including the `circuits/spend-policy` Noir circuit.
- `scripts/*` and CI/deployment configuration (`vercel.json`, `.github/workflows/*`).

Out of scope:

- `packages/dashboard` (the React frontend) and general UI/UX issues. Please
  still report these, but they are a lower priority during the current
  backend-hardening phase.
- Third-party services CleverCon depends on (the Stellar network itself, the
  x402 facilitator, Anthropic's API, Render). Report these to their respective
  maintainers.
- Issues that require a compromised local environment or physical access to a
  user's machine.

## Known limitations

We state these plainly rather than hide them:

- **Privacy is v1.** The on-chain PolicyVerifier performs a host-accelerated
  binding check over the public inputs, not full pairing-based verification
  (Soroban has no pairing host function), so the proving stack is trusted for
  predicate soundness. In v1 the caps/allowlist are also enforced off-chain by the
  API, with the on-chain budget + commitment + binding proof as the anchor. Full
  on-chain verification is pending Stellar pairing precompiles. See
  [docs/private-policies.md](docs/private-policies.md) section 7.
- **No third-party audit yet.** The contracts and API have not had an external
  security audit; that is a pre-mainnet roadmap item.
- **Delegate keys.** The per-user delegate secret is stored AES-256-GCM encrypted
  in Postgres; the encryption key (`DELEGATE_ENCRYPTION_KEY`) is an operator
  responsibility (a KMS is the mainnet plan).

If you find additional issues along these lines, please still report them.
Duplicates help us prioritize.
