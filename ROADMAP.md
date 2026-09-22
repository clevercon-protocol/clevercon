# Roadmap

## Vision

CleverCon lets you safely put an AI agent in charge of money on Stellar. You fund
a non-custodial Soroban vault, set the limits it must obey (a budget, per-payment
caps, an allowlist of payees, time windows), optionally keep those limits private,
and your agent then decides how to spend and disburse funds within them. The vault
enforces the boundary on-chain, so neither the agent nor the platform can exceed
it, and the platform never holds your funds.

It is a spending-control layer, not a payment rail: Stellar moves the money;
CleverCon governs how an agent may spend it, privately. Three things define it:

- **Delegated decisions, hard limits.** The agent has autonomy over who, when, and
  how much within the allowed set; the contract guarantees it can never spend
  outside your rules or pay an unapproved party.
- **Privacy, the differentiator.** The rules are enforced on-chain but kept
  private, which is what separates CleverCon from transparent, custodial, or
  escrow alternatives.
- **One primitive, many uses.** Hiring services is one application. The same
  bounded, private payments cover autonomous disbursements and payouts, recurring
  vendor and API payments, agent-to-agent payments, treasury automation, grant and
  bounty disbursement, and bounded allowances.

Not tied to AI-only or to a marketplace: any Stellar address you allowlist can be
paid, and the curated directory of services is a convenience, not the product.

Today the vault enforces spending with a binding proof. The headline roadmap item
is the full zero-knowledge policy circuit, so the rule stays private under a formal
soundness guarantee.

## Current status

Live on Stellar testnet today:

- **CleverVault** (Soroban): non-custodial deposits, per-task budget locking,
  proof-gated per-step release, refunds, multi-asset support, storage TTL
  management, and admin controls, with a 100+ case test suite.
- **PolicyVerifier** (Soroban): an on-chain `verify_policy` entrypoint. A proof
  built by the TypeScript prover is accepted by the deployed contract and a
  mismatched amount is rejected (real cross-language validation).
- **Registry** (Soroban): on-chain service registration and reputation.
- **Backend**: a NestJS API (SEP-10 wallet auth, RBAC, scoped API keys with daily
  quotas, step-up auth for money actions, rate limiting, structured logging), a
  resumable event indexer, and BullMQ workers for execution, proof generation, and
  exactly-once settlement, with Socket.IO real-time over a Redis adapter.
- **Web app**: fund a vault, set private spending limits, hire services, request a
  compliance proof, and watch releases settle.
- **SDK** (`@clevercon/agent-sdk`): `createSpender` (a bounded spending account),
  `createAgentWallet` (x402 agent-key mode), and `createProvider`/`createAgent` (be
  a paid service), plus a **Stellar MCP server** (`@clevercon/mcp`, 12 tools).
- **Programmable payments**: pay any allowlisted address or disburse to many in one
  bounded, private, proof-gated instruction, plus a natural-language chat agent (you
  approve; the vault enforces). Not tied to the hire flow.
- **Agent-key mode** for the open x402/MPP economy: the vault tops up the agent's
  own key under the policy and the agent pays external x402 services, settling in
  the same USDC. Proven end to end on testnet.
- **Private spending policies** enforced with a binding proof (v1): the rule is
  committed, never stored in the clear.
- **Production hardening**: an async settlement path with per-signer sequencing and
  exactly-once release, client idempotency keys, signed webhooks, and liveness +
  readiness probes.

Proven end to end: a 29-stage headless testnet harness (`scripts/e2e-testnet.ts`)
drives the whole loop with a fresh keypair and no browser, fund, policy, delegate,
pay, disburse, hire, SDK + MCP spends, agent-key top-up + external x402 payment,
signed webhook, idempotent retry, and withdraw, each a real on-chain settlement.
Placed 2nd in the Stellar Agents hackathon.

## Roadmap

Toward mainnet:

- **Full zero-knowledge policy circuit** replacing the binding proof, so the
  policy stays private under a formal soundness guarantee. The headline item. The
  commitment scheme, public inputs, nullifier derivation, and threat model are
  frozen in [docs/private-policies.md](docs/private-policies.md).
- **Full on-chain proof verification**: replace the binding check with real
  pairing-based verification once Stellar exposes pairing precompiles, so soundness
  is enforced on-chain rather than trusted off-chain.
- **Security audit** of the contracts and API, plus disaster-recovery and
  monitoring hardening (secrets in a KMS, backups, alerting).
- **Mainnet deploy** with a clear testnet/mainnet switch.
- **Real traction** with design partners, measured in on-chain payments.
- **Publish** the SDK and MCP server for external install.

Longer term: confidential amounts and counterparties (pending Stellar confidential
tokens), deeper ecosystem integrations, and on-chain dispute resolution.

See the [issue tracker](https://github.com/clevercon-protocol/clevercon/issues)
and [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
