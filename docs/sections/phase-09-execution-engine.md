# Phase 9: Orchestrator Execution Engine

## Summary
Built the orchestrator's execution layer — four modules that pay agents, run plans in parallel, and stream real-time events. Verified with real USDC payments on Stellar testnet.

## Files Created
- `packages/orchestrator/src/x402-client.ts` — x402 paying fetch, extracts tx_hash from `PAYMENT-RESPONSE` header (`decoded.transaction`)
- `packages/orchestrator/src/mpp-client.ts` — MPP client using `Mppx.create` from `mppx/client` + `stellar({ secretKey })` from `@stellar/mpp/charge/client`
- `packages/orchestrator/src/executor.ts` — `PlanExecutor` class: dependency-level parallel execution, health check → payment → rate → feedback
- `packages/orchestrator/src/server.ts` — Express + `ws` WebSocket server, `POST /api/tasks`, `GET /api/agents`, `GET /api/wallets`, `WS /ws`

## Files Fixed
- All agent `register.ts` files: `endpoint` updated from base URL to action path (`/query`, `/report`, `/analyze`)
- `data/registry.json`: patched in-place with correct endpoint paths
- `packages/agents/reporter/src/server.ts`: accepts `{ query, context }` body (orchestrator-style) in addition to `{ data }` / `{ sections }`
- `packages/orchestrator/src/x402-client.ts`: tx_hash extraction header order fixed to `PAYMENT-RESPONSE` → `X-PAYMENT-RESPONSE`; field is `decoded.transaction` not `decoded.txHash`

## End-to-End Verification

### Task: "Get the current XLM price and create a brief report summarizing it"
- Status: **complete**
- Steps: 2 (StellarOracle → ReporterBot)
- Total cost: $0.0300 USDC
- Total time: 43,534ms

### Step 1 — StellarOracle (x402, $0.02)
- Success: ✅
- TX hash: `8242f8598beae8600060a99e418d49d863c6dd289de9e49a5657622fcf8b8fbd`
- Explorer: https://stellar.expert/explorer/testnet/tx/8242f8598beae8600060a99e418d49d863c6dd289de9e49a5657622fcf8b8fbd
- Output: Live XLM/USDC DEX trades, cross-exchange data, ~$0.1616 USD

### Step 2 — ReporterBot (x402, $0.01)
- Success: ✅
- TX hash: `e4ae74e6c8295a25a929b1de38119ef13eda55539bc9d38311199926fc7212d2`
- Explorer: https://stellar.expert/explorer/testnet/tx/e4ae74e6c8295a25a929b1de38119ef13eda55539bc9d38311199926fc7212d2
- Output: Formatted markdown report with executive summary, market pricing table

### WebSocket events fired (in order)
`plan_created` → `plan_validated` → `task_started` → `step_started×2` → `step_complete×2` → `task_complete` → `task_result`

## Key Design Decisions
- **Dependency-level parallelism**: steps with `depends_on: null` run in `Promise.all`; dependent steps wait for their level
- **Health check before payment**: avoids wasting USDC on dead agents
- **Context chaining**: each step receives the output of its `depends_on` steps as `context` string
- **tx_hash field**: x402 `SettleResponseV1` uses `transaction` (not `txHash`) field; encoded in `PAYMENT-RESPONSE` header (not `X-PAYMENT-RESPONSE`)
- **Feedback loop**: executor POSTs reputation feedback to registry after each step (best-effort)
- **Async task execution**: `POST /api/tasks` returns 202 immediately; pipeline runs in background and streams events via WebSocket

## Issues Encountered and Fixed
- **Agents registered with base URL**: All agents registered `endpoint: SELF_URL` (no path). Fixed to `endpoint: \`${SELF_URL}/query\`` etc.
- **Reporter body mismatch**: Orchestrator sends `{ query, context }` but reporter expected `{ data }`. Fixed reporter to accept both.
- **tx_hash null**: x402 puts hash in `PAYMENT-RESPONSE` header (not `x-payment-receipt`), field is `transaction`. Fixed extraction order and field name.
