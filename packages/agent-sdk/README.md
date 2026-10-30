# @clevercon/agent-sdk

Give an AI agent a **private, non-custodial spending account on Stellar**, and an economy
to use it in: pay, disburse, hire and pay services (x402/MPP), or **be** a paid service,
all within limits only you set and no one else can see.

Part of [CleverCon](https://clevercon.xyz). For a no-code MCP integration (Claude Desktop,
Cursor), see [`@clevercon/mcp`](https://www.npmjs.com/package/@clevercon/mcp).

## Install

```bash
npm install @clevercon/agent-sdk
```

ESM-only. Requires Node 18+. The spending surfaces (`createSpender`,
`createAgentWallet`) have no heavy dependencies and use the global `fetch`.

## Prerequisites (for the spending surfaces)

1. Open the app at **https://clevercon.xyz** and connect a Stellar wallet (testnet).
2. **Fund your vault** and authorize the agent once, in the app.
3. In the **Developer console**, mint a scoped **API key** (`cc_<prefix>.<secret>`).

The API base defaults to the live CleverCon API; set `CLEVERCON_API_URL` only if you
self-host. The provider surfaces (`createProvider`, `createAgent`) do not need an API key.

## The four surfaces, pick what your agent needs

1. **Spend** (`createSpender` + `@clevercon/agent-sdk/sessions`) — a bounded, non-custodial
   spending account in two lanes: **private** (self-custody, keyless, trustless, via
   `disbursePrivate`) and **public / Fast** (a bounded on-chain session key). **Start here
   if your agent needs to spend.**
2. **Agent-key mode** (`createAgentWallet`) — the agent pulls working capital from the
   vault into its own wallet (bounded by your policy) and pays **external** x402 services
   with it. Start here to reach services outside CleverCon.
3. **Be a provider** (`createProvider`) — list a service the CleverCon hire flow calls per
   step; the vault settles you on-chain after each step succeeds.
4. **Standalone paid agent** (`createAgent`) — run your own x402 / MPP paywall and charge
   callers directly.

The spending surfaces are on the package root; `@clevercon/agent-sdk/spender` and
`@clevercon/agent-sdk/provider` are dependency-free subpaths.

## Spend

Two non-custodial lanes, matching the dapp and MCP: **private** (self-custody, keyless,
trustless) and **public / Fast** (a bounded on-chain session key). Reads and config
(`getBudget`, `setLimit`, ...) use a scoped API key; the spend itself never does.

### Private spend (`createSpender().disbursePrivate`)

Proves your hidden policy **locally** and relays only a zero-knowledge proof; the vault
releases against your pinned commitment with a fresh nullifier, so no key signs the spend
and the server never sees your rule. One proof authorizes up to 4 payouts.

```ts
import { createSpender } from '@clevercon/agent-sdk/spender';

// Provide the policy bundle inline, or set CLEVERCON_POLICY_KEY to the key you
// copied from the dapp's Rules tab. Circuit artifacts download on first use.
const cc = createSpender({
  apiKey: process.env.CLEVERCON_API_KEY!, // for reads/config (not the spend itself)
  policyBundle: JSON.parse(process.env.CLEVERCON_POLICY_JSON!), // { rules, salt }
});

await cc.disbursePrivate([
  { payee: 'G...A', amount: 2 },
  { payee: 'G...B', amount: 3 },
]);

// Read the vault position and manage saved limits (scoped API key)
const { available } = await cc.getBudget();
const limit = await cc.setLimit({ perPaymentCeilingUsdc: 10, allowlist: ['G...'] });
```

- `disbursePrivate(lines, opts?)` — self-custody private spend (pp/2). Needs a policy
  bundle (`options.policyBundle` or `CLEVERCON_POLICY_KEY`); add `globalBundle` /
  `CLEVERCON_GLOBAL_KEY` when the account has a global-private rule.
- `getBudget()` / `getActivity()` / `setLimit(limit)` / `listLimits()` / `hire(opts)` —
  reads and config over a scoped API key (`hire` / `setLimit` take `idempotencyKey`).
- `pay` / `disburse` are **retired** (the managed server-signed path); calling them throws
  `CleverConError`. Use `disbursePrivate`, or the session lane below.

### Public / Fast spend (`@clevercon/agent-sdk/sessions`)

A bounded on-chain session key (cap + payee allowlist + expiry) spends with no per-payment
proof, for high-frequency low-value work. The owner mints the session once; the agent runs
with only the session key, signing directly against Soroban (no API).

```ts
import { registerSession, createSessionSpender } from '@clevercon/agent-sdk/sessions';

// Owner: authorize a bounded session (once)
const { sessionSecret } = await registerSession({
  ownerSecret: process.env.OWNER_SECRET!,
  spendCap: 20,
  allowlist: ['G...PAYEE'],
  expirySecs: 7 * 24 * 3600,
});

// Agent: spend with ONLY the session key
const spender = createSessionSpender(sessionSecret);
await spender.pay('G...PAYEE', 1);
const scope = await spender.scope(); // remaining budget, allowlist, expiry
```

Verify any settled spend with `receipt(...)` from `@clevercon/agent-sdk/receipts`: it
decodes the on-chain tx to show the authorizer, a session key (public) or a ZK proof
(private), so you can confirm which lane actually ran.

Errors throw `CleverConError` (spend / read) or `SessionError` (session ops), carrying the
HTTP status or the contract reason.

## Agent-key mode (`createAgentWallet`)

Unites the two non-custodial halves of an agent's economy: it **pulls** working capital
from the vault (bounded on-chain by your policy) and **spends** it on external x402
services. The platform never holds the agent's key, and both legs settle in the same
USDC, so there is no swap between them.

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

See [`examples/x402-agent`](https://github.com/clevercon-protocol/clevercon/tree/main/packages/agent-sdk/examples/x402-agent)
for a runnable end-to-end agent.

## Be a provider (`createProvider`)

The smallest glue that turns a function into a service the CleverCon marketplace can hire.
Dependency-free (`node:http` only), so a provider is a single file with no framework.

```ts
import { createProvider } from '@clevercon/agent-sdk/provider';

const provider = createProvider({
  name: 'price-oracle',
  port: 4200,
  async fulfill({ action, taskId }) {
    const price = await lookupPrice(action);
    return { action, price, at: new Date().toISOString() };
  },
});

provider.listen(); // POST / to fulfill, GET /health for liveness
```

Then register the service with its endpoint URL in the app's Provider console, and
CleverCon drives the rest.

### Fulfillment contract

The CleverCon worker drives your endpoint. `createProvider` implements this for you; it
is documented so you know exactly what runs:

| Exchange | Detail |
| --- | --- |
| `POST <endpoint>` | request body `{ action, taskId }` (application/json) |
| response | any `2xx` with a body = the step output the buyer sees |
| output size | truncated to `MAX_OUTPUT_CHARS` (2000); keep results concise |
| failure | non-`2xx` or a timeout (the worker aborts at 15s) fails the step |
| `GET <endpoint>/health` | `{ status: 'ok', provider }` |

- `fulfill({ action, taskId, body })` — `action` is the plan step, `taskId` is the
  CleverCon task, `body` is the full parsed request. Return a string (sent verbatim) or
  any object (JSON-encoded). **Throw to fail the step** (mapped to HTTP 500, so the vault
  does not pay for it).
- `provider.handle(req, res)` — the bare handler, to embed in an existing server or test
  without a socket. `provider.listen(port?)` opens an http server.

The [`@clevercon/reference-provider`](https://github.com/clevercon-protocol/clevercon/tree/main/services/reference-provider)
service is a real, hireable provider built on `createProvider`.

## Standalone paid agent (`createAgent`)

Scaffolding for a specialist agent that runs **its own paywall** and charges callers
directly (independent of a CleverCon vault). It factors out the lifecycle: an HTTP server
with a manifest and health endpoint, an x402 or MPP paywall on the task endpoint, optional
self-registration with an agent registry, and feedback reporting.

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
| `POST /query` | paid task endpoint: x402/MPP paywall, then your `handler` |

### The handler

```ts
handler: (task, ctx) => AgentResult | Promise<AgentResult>;
```

- `task` — `{ body, query, context, req }`. `query` is `body.query` or `body.instruction`;
  `context` is `body.context`; `req` is the raw Express request.
- `ctx` — `{ wallet: { publicKey }, payment, logger }`.
- Return a plain value (wrapped as `{ result, agent, timestamp }`) or `{ result, status }`
  to set the HTTP status. Throw to return `{ error: message }` (status from `err.status`,
  else 500).

### Config

| Field | Default |
| --- | --- |
| `manifest`, `capabilities`, `price`, `payment`, `handler`, `wallet` | required |
| `registryUrl` | `process.env.REGISTRY_URL` (optional, see below) |
| `selfUrl` | `process.env.SELF_URL` or `http://localhost:<port>` |
| `port` | `process.env.PORT` or `3000`; `listen(port)` overrides |
| `taskPath` | `/query` |
| `network` | `process.env.STELLAR_NETWORK` or `stellar:testnet` |
| `facilitatorUrl` | `process.env.X402_FACILITATOR_URL` or the x402.org facilitator |
| `heartbeatMs` | `240000` (`0` disables re-registration) |
| `cors`, `gracefulShutdown` | `true` |

Invalid config throws `AgentConfigError` at `createAgent()`, so the agent fails fast rather
than at the first request.

**Registry self-registration is optional.** If you set `registryUrl`, the agent registers
itself with that agent registry on `listen()` (retrying on a `5s / 15s / 30s / 60s`
backoff, re-registering every `heartbeatMs`, and deregistering on `SIGTERM`/`SIGINT`). The
paywall works with or without a registry. The CleverCon marketplace lists services via the
Provider console (see `createProvider`), so a registry is only needed if you run your own
agent directory.

### Programmatic API

```ts
agent.app; // the Express app (for tests / mounting)
agent.address; // public key derived from the wallet
agent.manifest; // the registration payload
await agent.registerSelf();
await agent.deregister();
await agent.reportFeedback(jobId, { success: true, quality_rating: 5, latency_ms: 1200 });
agent.listen(port);
agent.stop(); // cancel heartbeat / pending retries
```

### Escape hatches

- `routes: (app) => { ... }` — register extra unpaid routes, or mutate `agent.app` before `listen()`.
- `middleware` — replace the built-in payment middleware entirely.
- `deps` — inject the x402 / MPP / `fetch` implementations (used by the tests).

## Payment middleware (standalone)

Use the x402 / MPP primitives directly, without `createAgent`:

- `withX402(opts)` / `withMpp(opts)` — Express middleware that puts a paywall on a route.
- `createPayingFetch({ secretKey })` — a `fetch` that settles x402 `402` challenges, for
  agents that pay downstream services.

## Registry client (optional, `createRegistryClient`)

A low-level client for an agent registry (`register` / `deregister` / `feedback` against a
`registryUrl` you provide). `createAgent` uses it internally; use it directly only if you
run your own agent directory. Most users do not need this.

## Error handling

- `CleverConError` — thrown by the spending surfaces; carries the HTTP `status`
  (e.g. 401 invalid key, 429 quota exceeded) and the server message.
- `AgentConfigError` — thrown by `createAgent()` on invalid config.

## Examples

Runnable examples live in the repository:
[`examples/x402-agent`](https://github.com/clevercon-protocol/clevercon/tree/main/packages/agent-sdk/examples/x402-agent),
[`examples/stellar-oracle`](https://github.com/clevercon-protocol/clevercon/tree/main/packages/agent-sdk/examples/stellar-oracle),
and [`examples/minimal-mpp`](https://github.com/clevercon-protocol/clevercon/tree/main/packages/agent-sdk/examples/minimal-mpp).

## Links

- App and Developer console: https://clevercon.xyz
- MCP server: [`@clevercon/mcp`](https://www.npmjs.com/package/@clevercon/mcp)
- Source and issues: https://github.com/clevercon-protocol/clevercon

## License

MIT
