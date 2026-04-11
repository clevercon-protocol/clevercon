# Phase 6: Analysis Agent (MPP)

## Summary
Built the AnalysisBot — a Claude-powered data analysis agent that uses the Machine Payment Protocol (MPP) for pay-per-chunk billing.

## Files Created
- `packages/agents/analysis/package.json` — deps: `@stellar/mpp@^0.3.0`, `mppx@latest`, `@anthropic-ai/sdk`, `@stellar/stellar-sdk@^14.6.1`
- `packages/agents/analysis/src/analyze.ts` — Claude Haiku (`claude-haiku-4-5-20251001`) analysis with 800 token limit
- `packages/agents/analysis/src/register.ts` — Self-registers with registry as `analysis-agent`, model: `mpp`, price: 0.005 USDC
- `packages/agents/analysis/src/server.ts` — Express server with MPP payment middleware on `POST /analyze`

## Architecture
- **Port**: 4004
- **Payment**: MPP (Machine Payment Protocol) via `@stellar/mpp@0.3.0` + `mppx@latest`
- **Price**: 0.005 USDC per analysis call
- **Model**: Claude Haiku for cost-effective analysis

## MPP Integration Pattern
```typescript
// Server setup
const mppx = Mppx.create({
  methods: [stellar({ recipient: PAY_TO, currency: USDC_SAC_TESTNET, network: STELLAR_TESTNET, rpcUrl: '...' })],
  secretKey: SECRET_KEY,
  realm: 'agentforge-analysis',
});

// Handler — convert Express req → Fetch Request → MPP
const result = await mppx['stellar/charge']({ amount: '0.005', ... })(fetchReq);
if (result.status === 402) {
  // result.challenge is the Fetch Response with WWW-Authenticate header
  challenge.headers.forEach((v, k) => res.setHeader(k, v));
  res.status(402).json(await challenge.json());
  return;
}
// Payment verified — run Claude, attach receipt
const receiptResult = result.withReceipt(new Response(body));
```

## Key Fixes During Implementation
1. **stellar-sdk version conflict** — `@stellar/mpp@0.3.0` requires `stellar-sdk@^14.6.1`. Updated analysis `package.json` and installed with `--legacy-peer-deps`. npm resolved 14.6.1 locally in analysis's `node_modules`.
2. **Network key** — MPP uses `'stellar:testnet'` (imported as `STELLAR_TESTNET`) not `'testnet'`
3. **rpcUrl required** — Added explicit `rpcUrl: 'https://soroban-testnet.stellar.org'` to avoid lookup failure
4. **Em dash in description** — HTTP headers must be ASCII; replaced `—` with `-`
5. **mppx response structure** — Result is `{ status, challenge, withReceipt }` not a bare Fetch Response. Use `result.challenge` for 402 headers, `result.withReceipt()` for paid responses

## Verification
- `GET /health` → `{ status: 'ok', agent: 'AnalysisBot', payment: 'MPP' }`
- `POST /analyze` without payment → HTTP 402 with `www-authenticate: Payment ...` header and `challengeId`
