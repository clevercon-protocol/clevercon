# Roadmap

## Vision

CleverCon gives an AI agent a private, non-custodial spending account on Stellar,
and an economy to use it in. You fund a non-custodial Soroban vault, set the limits
the agent must obey (a budget, per-payment caps, an allowlist of payees, time
windows), and keep those limits private. Your agent can then pay a vendor, disburse
to many, hire services and pay per call for APIs, or pay other agents, all within
rules only you set and no one else can see. The vault enforces the boundary
on-chain, so neither the agent nor the platform can exceed it, and the platform
never holds your funds.

Spending control is the guarantee; the economy is the point. Three things define it:

- **Bounded and non-custodial.** The agent has autonomy over who, when, and how
  much within the allowed set; the contract guarantees it can never spend outside
  your rules or pay someone you did not approve, and never takes custody.
- **Private, the differentiator.** The rules are enforced on-chain but kept
  private, which separates CleverCon from transparent, custodial, or escrow
  alternatives.
- **A real economy.** Direct payments and disbursements to any allowlisted address,
  plus a registered service market where agents hire and pay per call (x402/MPP),
  with on-chain reputation, covering autonomous payouts, recurring vendor and API
  payments, agent-to-agent payments, treasury automation, and bounded allowances.

The vault enforces spending with zero-knowledge proofs verified on-chain, so a
payment moves only when it provably obeys your committed rules, and the rule itself
stays private, without trusting an off-chain prover.

## Current status

Live on Stellar testnet today:

- **CleverVault** (Soroban): non-custodial deposits, per-task budget locking,
  proof-gated per-step release, refunds, multi-asset support, storage TTL
  management, and admin controls, with a 100+ case test suite.
- **PolicyVerifier** (Soroban): on-chain zero-knowledge proof verification
  (Groth16 over BLS12-381, using Stellar's native pairing). A client-generated
  proof is verified on-chain before any release; an invalid one is rejected.
- **Registry** (Soroban): on-chain service registration and reputation.
- **Backend**: a NestJS API (SEP-10 wallet auth, RBAC, scoped API keys with daily
  quotas, step-up auth for money actions, rate limiting, structured logging), a
  resumable event indexer, and BullMQ workers for execution, proof generation, and
  exactly-once settlement, with Socket.IO real-time over a Redis adapter.
- **Web app**: fund a vault, set private spending limits, hire services, request a
  compliance proof, and watch releases settle.
- **SDK** (`@clevercon/agent-sdk`): `createSpender` (a bounded spending account),
  `createAgentWallet` (x402 agent-key mode), and `createProvider`/`createAgent` (be
  a paid service), plus a **Stellar MCP server** (`@clevercon/mcp`).
- **Programmable payments**: pay any allowlisted address or disburse to many in one
  bounded, private, proof-gated instruction, plus a natural-language chat agent (you
  approve; the vault enforces). Not tied to the hire flow.
- **Agent-key mode** for the open x402/MPP economy: the vault tops up the agent's
  own key under the policy and the agent pays external x402 services, settling in
  the same USDC. Proven end to end on testnet.
- **Private spending policies** enforced trustlessly: a zero-knowledge proof
  (generated on your side) is verified on-chain for every release, and the rule is
  committed, never stored or published in the clear.
- **Production hardening**: an async settlement path with per-signer sequencing and
  exactly-once release, client idempotency keys, signed webhooks, and liveness +
  readiness probes.

Proven end to end: a headless testnet harness (`scripts/e2e-testnet.ts`) drives the
whole loop with a fresh keypair and no browser, fund, policy, delegate, pay,
disburse, hire, SDK + MCP spends, agent-key top-up + external x402 payment, signed
webhook, idempotent retry, and withdraw, each a real on-chain settlement. Placed
2nd in the Stellar Agents hackathon.

## Roadmap

Toward mainnet:

- **Shrink custody further.** Releases are already proof-gated; move the settlement
  path from a signer toward a pure relayer so the platform's signing role shrinks
  toward zero. The commitment scheme, public inputs, nullifier derivation, and
  threat model are in [docs/private-policies-v2.md](docs/private-policies-v2.md).
- **Fee sponsorship**, so a user holding only USDC (no XLM) can do everything.
- **Seed and protect the service directory**, and the open x402 agent economy.
- **Security audit** of the contracts and API, plus disaster-recovery and
  monitoring hardening (secrets in a KMS, backups, alerting).
- **Mainnet deploy** with a clear testnet/mainnet switch.
- **Real traction** with design partners, measured in on-chain payments.
- **Publish** the SDK and MCP server for external install.

Longer term: confidential amounts and counterparties (pending Stellar confidential
tokens), deeper ecosystem integrations, and on-chain dispute resolution.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
and [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
