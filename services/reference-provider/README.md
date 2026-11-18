# @clevercon/reference-provider

The minimal real provider for the CleverCon marketplace. It exists to prove (and
document) the **provider fulfillment contract**: what the worker sends a provider
and what it expects back. Any endpoint that honours this contract is a valid
provider, whether it is 40 lines or a full agent.

It is built on `createProvider` from
[`@clevercon/agent-sdk/provider`](../../packages/agent-sdk), so it doubles as the
SDK's dogfood example: the SDK handles health, body parsing, encoding, and
error-to-500 mapping, and the only thing written here is the work itself.

## Fulfillment contract

The worker (`services/workers` executor) calls a service's `endpoint` per step:

```
POST <endpoint>
Content-Type: application/json

{ "action": "<what to do>", "taskId": "<task id>" }
```

- **Success:** respond `2xx` with a body (up to 2000 chars). The body is stored
  as the step's `output` and the step is marked `RELEASED`. If the task is
  locked on-chain under a policy, the provider is then paid on settlement.
- **Failure:** any non-`2xx`, or no response within 15s, marks the step
  `FAILED` (and counts against the provider's reputation).

It also serves `GET /health`.

## Run it

```
PROVIDER_PORT=4200 PROVIDER_NAME="Stellar Oracle" npm run -w @clevercon/reference-provider start
```

Then register it on the API as a service with `endpoint = http://localhost:4200`
(the `POST /provider/services` endpoint, or the provider console). A buyer hire
routed to it will call this server; a real provider would do the actual work
(a data lookup, an LLM call, a computation) in place of the echo.
