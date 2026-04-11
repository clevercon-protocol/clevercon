# Phase 3: Stellar Oracle Agent

## What Was Built

Created `packages/agents/stellar-oracle` — an x402-paywalled Express server that serves live Stellar blockchain data.

**Files:**
- `src/horizon.ts` — Pure Stellar Horizon API calls: DEX trades (XLM/USDC pair), orderbook with spread calculation, account balances, and network stats (latest ledger, base fee)
- `src/register.ts` — On-startup self-registration with the Service Registry
- `src/server.ts` — Express server with x402 payment middleware

## Key Decisions

- **x402 API version**: Used `paymentMiddleware` from `@x402/express` v2.8.0, which takes `(routes, resourceServer, ...)`. The `x402ResourceServer` is constructed with `HTTPFacilitatorClient` and the `ExactStellarScheme` registered for `stellar:testnet`.
- **Price**: $0.02 USDC per `/query` call (POST), as specified in the guide.
- **Facilitator**: `https://www.x402.org/facilitator` (Coinbase testnet). Confirmed reachable and returns `stellar:testnet` in its supported kinds.
- **Node.js**: System was on Node 12; switched to NVM Node 20 (v20.18.0). Added `.nvmrc` pinning to Node 20.

## Verification Results

| Check | Result |
|---|---|
| `GET /health` | 200 OK with agent name and wallet address |
| `POST /query` (no payment) | HTTP 402 Payment Required |
| Self-registration | Agent appears in registry with 6 capabilities |
| Horizon live data | Latest ledger fetched, orderbook spread calculated |
| Facilitator reachable | Confirmed via Node.js fetch — supports `stellar:testnet` |
