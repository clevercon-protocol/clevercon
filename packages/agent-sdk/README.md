# @clevercon/agent-sdk

Shared scaffolding for CleverCon specialist agents. Factors out the lifecycle
every agent in `packages/agents/*` re-implements by hand: an HTTP server with a
manifest and health endpoint, an x402 or MPP paywall on the task endpoint,
self-registration with the registry (retry/backoff + heartbeat), graceful
deregistration, and feedback reporting.

## Quickstart

```ts
import 'dotenv/config';
import { createAgent } from '@clevercon/agent-sdk';

const agent = createAgent({
  manifest: {
    agent_id: 'sentiment-bot',
    name: 'SentimentBot',
    description: 'Scores the sentiment of a piece of text.',
  },
  capabilities: ['sentiment-analysis'],
  price: 0.01, // USDC per call
  payment: 'x402', // or 'mpp'
  wallet: { secretKey: process.env.SENTIMENT_BOT_SECRET_KEY! },
  handler: async (task) => {
    const score = await scoreSentiment(task.query);
    return { sentiment: score };
  },
});

agent.listen(4200);
```

That gives you:

| Route | Behaviour |
| --- | --- |
| `GET /health` | `{ status: 'ok', agent, address, payment }` |
| `GET /` | manifest: `{ agent, description, capabilities, pricing, stellar_address }` |
| `POST /query` | paid task endpoint — x402/MPP paywall, then your `handler` |

On `listen()` the agent registers itself with the registry (`REGISTRY_URL`,
default `http://localhost:4000`), retries on a `5s / 15s / 30s / 60s` backoff if
the registry is not up yet, re-registers every 4 minutes, and deregisters on
`SIGTERM` / `SIGINT`.

## The handler

```ts
handler: (task, ctx) => AgentResult | Promise<AgentResult>;
```

- `task` — `{ body, query, context, req }`. `query` is `body.query` or
  `body.instruction`; `context` is `body.context`. `req` is the raw Express
  request.
- `ctx` — `{ wallet: { publicKey }, payment, logger }`.
- Return a plain value (wrapped as `{ result, agent, timestamp }`) or
  `{ result, status }` to set the HTTP status. Throw to return
  `{ error: message }` (status from `err.status`, else 500).

## Config

| Field | Default |
| --- | --- |
| `manifest`, `capabilities`, `price`, `payment`, `handler`, `wallet` | required |
| `registryUrl` | `process.env.REGISTRY_URL` or `http://localhost:4000` |
| `selfUrl` | `process.env.SELF_URL` or `http://localhost:<port>` |
| `port` | `process.env.PORT` or `3000`; `listen(port)` overrides |
| `taskPath` | `/query` |
| `network` | `process.env.STELLAR_NETWORK` or `stellar:testnet` |
| `facilitatorUrl` | `process.env.X402_FACILITATOR_URL` or the x402.org facilitator |
| `rpcUrl` | Soroban testnet RPC (MPP) |
| `heartbeatMs` | `240000` (`0` disables) |
| `syncFacilitatorOnStart` | `true` (x402) |
| `cors`, `gracefulShutdown` | `true` |

Invalid config throws `AgentConfigError` at `createAgent()` — the agent fails
fast rather than at the first request.

## Escape hatches

- `routes: (app) => { ... }` — register extra unpaid routes, or mutate
  `agent.app` directly before `listen()`.
- `middleware` — replace the built-in payment middleware entirely.
- `deps` — inject the x402 / MPP / `fetch` implementations (used by the tests).
- `withX402(opts)` / `withMpp(opts)` — the payment middleware factories, usable
  standalone.
- `createPayingFetch({ secretKey })` — a `fetch` that settles x402 `402`
  challenges, for agents that pay downstream services.

## Programmatic API

```ts
const agent = createAgent(config);
agent.app; // the Express app (for tests / mounting)
agent.address; // public key derived from the wallet
agent.manifest; // the payload sent to the registry
await agent.registerSelf();
await agent.deregister();
await agent.reportFeedback(jobId, { success: true, quality_rating: 5, latency_ms: 1200 });
agent.listen(port);
agent.stop(); // cancel heartbeat / pending retries
```

## Examples

- [`examples/stellar-oracle`](./examples/stellar-oracle) — the `stellar-oracle`
  agent rebuilt on the SDK, byte-for-byte parity on manifest, health, the x402
  paywall, the `/cache/stats` route, and downstream x402 payments. Covered by
  `src/parity.test.ts`.
- [`examples/minimal-mpp`](./examples/minimal-mpp) — the smallest MPP agent:
  a manifest, a handler, a wallet.

```bash
EXAMPLE_ORACLE_SECRET_KEY=S... npm run example:oracle -w @clevercon/agent-sdk
```
