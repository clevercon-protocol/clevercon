# @clevercon/agent-sdk

The SDK for CleverCon. Four surfaces, pick what your agent needs:

1. **Spend** (`createSpender`) — a bounded, non-custodial spending account over the
   CleverCon API: pay, disburse, hire, set limits, read budget and activity, with a
   scoped API key. The agent spends but never overspends or pays outside your
   policy, and never holds funds. **Start here if your agent needs to spend.**
2. **Agent-key mode** (`createAgentWallet`) — the agent pulls working capital from
   the vault into its own wallet (bounded by your policy) and pays **external** x402
   services with it. Start here to reach services outside CleverCon.
3. **Be a provider** (`createProvider`) — list a service the CleverCon hire flow
   calls per step; the vault settles you on-chain after each step succeeds.
4. **Standalone paid agent** (`createAgent`) — run your own x402 / MPP paywall and
   charge callers directly, independent of the vault.

The spending surfaces are on the package root; the provider is on a zero-dependency
subpath (`@clevercon/agent-sdk/spender` is likewise dependency-free).

## Spend (`createSpender`)

A bounded, non-custodial spending account in a few calls. Zero runtime dependencies
(global `fetch` only), keyed by a scoped API key (mint one in the dApp Developer
console). Fund the vault and authorize Autopay once in the dApp; after that the
agent spends autonomously within your limits.

```ts
import { createSpender } from '@clevercon/agent-sdk/spender';

const cc = createSpender({ apiKey: process.env.CLEVERCON_API_KEY! });

await cc.pay('G...PAYEE', 5, { reason: 'design work' });
await cc.disburse([
  { payee: 'G...A', amount: 2 },
  { payee: 'G...B', amount: 3 },
]);
const { available } = await cc.getBudget();
const limit = await cc.setLimit({ perPaymentCeilingUsdc: 10, allowlist: ['G...'] });
```

- `pay(payee, amount, opts?)` / `disburse(lines, opts?)` — bounded by a saved limit
  (`policyId`) or one derived from the payment itself (allowlist = the payees, cap =
  the largest line). Pass `idempotencyKey` so a retried call returns the original
  spend instead of paying twice.
- `hire(opts)` — hire a registered service (also takes `idempotencyKey`).
- `getBudget()` / `getActivity()` / `setLimit(limit)` / `listLimits()`.
- Errors throw `CleverConError` carrying the HTTP status (401 bad key, 429 quota).

## Agent-key mode (`createAgentWallet`)

Unites the two non-custodial halves of an agent's economy: it PULLS working capital
from the CleverCon vault (bounded on-chain by your policy) and SPENDS it
autonomously on external x402 services. The platform never holds the agent's key,
and both legs settle in the same USDC, so there is no swap between them.

```ts
import { createAgentWallet } from '@clevercon/agent-sdk';

const wallet = createAgentWallet({
  apiKey: process.env.CLEVERCON_API_KEY!, // the governed vault side
  secretKey: process.env.AGENT_SECRET_KEY!, // the agent's OWN Stellar key
});

await wallet.topUp(5); // vault -> agent wallet, released within your policy
const res = await wallet.fetch(url, init); // pay an x402 service with those funds
const { available } = await wallet.getBudget();
```

See [`examples/x402-agent`](./examples/x402-agent) for a runnable end-to-end agent.

The remaining two surfaces are for being paid, not spending:

## Marketplace provider (`createProvider`)

The smallest amount of glue that turns a function into a service the CleverCon
marketplace can hire. Dependency-free (node:http only), so a provider is a
single file with no framework. Import it from the lightweight subpath:

```ts
import { createProvider } from '@clevercon/agent-sdk/provider';

const provider = createProvider({
  name: 'price-oracle',
  port: 4200,
  async fulfill({ action, taskId }) {
    // Do the actual work; the return value becomes the buyer's step output.
    const price = await lookupPrice(action);
    return { action, price, at: new Date().toISOString() };
  },
});

provider.listen(); // POST / to fulfill, GET /health for liveness
```

Register the service with its endpoint URL, and CleverCon does the rest.

### Fulfillment contract

The worker (`services/workers` executor) drives your endpoint. `createProvider`
implements this for you; it is documented here so you know exactly what runs:

| Exchange | Detail |
| --- | --- |
| `POST <endpoint>` | request body `{ action, taskId }` (application/json) |
| response | any `2xx` with a body = the step output the buyer sees |
| output size | truncated to `MAX_OUTPUT_CHARS` (2000); keep results concise |
| failure | non-`2xx` or a timeout (the worker aborts at 15s) fails the step |
| `GET <endpoint>/health` | `{ status: 'ok', provider }` |

- `fulfill({ action, taskId, body })`, `action` is the plan step, `taskId` is
  the CleverCon task, `body` is the full parsed request. Return a string (sent
  verbatim) or any object (JSON-encoded). **Throw to fail the step** (mapped to
  HTTP 500, so the vault does not pay for it).
- `provider.handle(req, res)`, the bare handler, to embed in an existing server
  or test without a socket. `provider.listen(port?)` opens an http server.

The [`@clevercon/reference-provider`](../../services/reference-provider) service
is this SDK's dogfood example: a real, hireable provider built on `createProvider`.

## Standalone paid agent (`createAgent`)

Shared scaffolding for a specialist agent that runs its own paywall. Factors out
the lifecycle such an agent otherwise re-implements by hand: an HTTP server with a
manifest and health endpoint, an x402 or MPP paywall
on the task endpoint, self-registration with the registry (retry/backoff +
heartbeat), graceful deregistration, and feedback reporting.

### Quickstart

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
| `POST /query` | paid task endpoint, x402/MPP paywall, then your `handler` |

On `listen()` the agent registers itself with the registry (`REGISTRY_URL`,
default `http://localhost:4000`), retries on a `5s / 15s / 30s / 60s` backoff if
the registry is not up yet, re-registers every 4 minutes, and deregisters on
`SIGTERM` / `SIGINT`.

## The handler

```ts
handler: (task, ctx) => AgentResult | Promise<AgentResult>;
```

- `task`, `{ body, query, context, req }`. `query` is `body.query` or
  `body.instruction`; `context` is `body.context`. `req` is the raw Express
  request.
- `ctx`, `{ wallet: { publicKey }, payment, logger }`.
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

Invalid config throws `AgentConfigError` at `createAgent()`, the agent fails
fast rather than at the first request.

## Escape hatches

- `routes: (app) => { ... }`, register extra unpaid routes, or mutate
  `agent.app` directly before `listen()`.
- `middleware`, replace the built-in payment middleware entirely.
- `deps`, inject the x402 / MPP / `fetch` implementations (used by the tests).
- `withX402(opts)` / `withMpp(opts)`, the payment middleware factories, usable
  standalone.
- `createPayingFetch({ secretKey })`, a `fetch` that settles x402 `402`
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

- [`examples/stellar-oracle`](./examples/stellar-oracle), the `stellar-oracle`
  agent rebuilt on the SDK, byte-for-byte parity on manifest, health, the x402
  paywall, the `/cache/stats` route, and downstream x402 payments. Covered by
  `src/parity.test.ts`.
- [`examples/minimal-mpp`](./examples/minimal-mpp), the smallest MPP agent:
  a manifest, a handler, a wallet.

```bash
EXAMPLE_ORACLE_SECRET_KEY=S... npm run example:oracle -w @clevercon/agent-sdk
```
