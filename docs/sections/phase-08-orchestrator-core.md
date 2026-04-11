# Phase 8: Orchestrator Core

## Summary
Built the orchestrator's brain — five modules that plan tasks, validate plans, select agents, and rate quality. No payment execution yet (Phase 9).

## Files Created
- `packages/orchestrator/package.json` — deps: `@anthropic-ai/sdk`, `@x402/fetch`, `@x402/stellar`, `@stellar/mpp`, `@stellar/stellar-sdk@^14.6.1`, `ws`, `uuid`
- `packages/orchestrator/src/capability-check.ts` — Claude-powered feasibility check anchored to known capability tags
- `packages/orchestrator/src/selector.ts` — Agent scoring with 5 weighted factors
- `packages/orchestrator/src/planner.ts` — Claude Sonnet task decomposition with Stellar context
- `packages/orchestrator/src/validator.ts` — Plan validation (agent IDs, budget, deps, payment methods)
- `packages/orchestrator/src/rater.ts` — Claude Haiku 1-5 quality rating, defaults to 3 on failure

## Module Verification Results

### capability-check
- Feasible task ("Get XLM price + blockchain news"): `{ feasible: true, needed: ["crypto-prices","blockchain-news"], available: [...], missing: [] }` ✅
- Impossible task ("3D model"): `{ feasible: false, needed: ["3d-modeling"], available: [], missing: ["3d-modeling"] }` ✅

### selector
- Scores all agents for capability match, reputation (0-100→0-1), price efficiency, latency, discovery bonus
- WebIntel agents rank above others for "news" capability ✅
- Pre-bootstrap: v2 ranks slightly above v1 (same rep score=50, but cheaper) — inverts after bootstrap builds reputation ✅

### planner
- Produces valid JSON `ExecutionPlan` using real agent IDs from registry ✅
- Sets `depends_on: null` for independent parallel steps ✅
- Uses Claude Sonnet with Stellar context in system prompt ✅
- Strips markdown fences, extracts JSON with fallback regex ✅

### validator
- Catches unknown agent IDs, over-budget plans, circular deps, payment model mismatch ✅
- Valid plan passes with `{ valid: true, errors: [] }` ✅

### rater
- Good response ("XLM price with data") → 4 ✅
- Poor response ("Error: timeout") → 1 ✅
- Defaults to 3 on Claude failure ✅

## Key Design Decisions
- **Capability prompt anchoring**: Prompt includes known agent capabilities so Claude uses matching tags rather than inventing unresolvable ones
- **Claude model split**: Planner uses `claude-sonnet-4-5` (complex reasoning); capability-check and rater use `claude-haiku-4-5-20251001` (cost saving)
- **JSON parsing robustness**: Planner strips code fences + falls back to regex extraction before throwing
