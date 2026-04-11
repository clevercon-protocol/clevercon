# Phase 4: External x402 Consumption (xlm402.com)

## What Was Built

Added `src/x402-consumer.ts` to the Stellar Oracle — an x402 **client** that pays xlm402.com for cross-exchange crypto data using the Oracle's own USDC wallet.

**Files changed:**
- `packages/agents/stellar-oracle/src/x402-consumer.ts` — new x402 client using `wrapFetchWithPaymentFromConfig` + `createEd25519Signer` + `ExactStellarScheme` (client-side)
- `packages/agents/stellar-oracle/src/server.ts` — updated `/query` handler to fetch xlm402 quote/candles in parallel with Horizon data; includes `payments_made` field in response

## Key Details

- The Oracle is simultaneously an x402 **server** (receives $0.02 from orchestrator) and an x402 **client** (pays $0.01 to xlm402.com) — the multi-layer economy in action.
- `getCryptoQuote(symbol)` — calls `xlm402.com/testnet/markets/crypto/quote?symbol=XLM-USD`
- `getCryptoCandles(symbol)` — calls `xlm402.com/testnet/markets/crypto/candles?symbol=XLM-USD`
- External calls are fire-and-forget with `.catch()` — if xlm402 is down the Oracle still returns Horizon data
- Symbol is auto-detected from the query string (BTC, ETH, SOL, XLM, XRP)

## Verification Results

| Check | Result |
|---|---|
| xlm402.com reachable | Health returns 44 published routes, 2 networks |
| `GET /testnet/markets/crypto/quote` | HTTP 402 without payment |
| Full payment flow | HTTP 200, real XLM price `$0.16450000` from Binance source |
| Oracle USDC balance | Dropped from 3.0000000 → 2.9900000 (real $0.01 USDC paid) |
| Oracle server with Phase 4 | Starts cleanly, 402 paywall still active |
