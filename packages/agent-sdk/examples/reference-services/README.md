# Reference provider services

Runnable templates (one per interaction archetype) built on the CleverCon provider
SDK (`@clevercon/agent-sdk/provider`). Copy one, replace the `fulfill` body with your
work, host it, and register the endpoint on CleverCon so agents can hire it. The
platform handles delivery, acceptance, settlement, and payout; you write only
`fulfill`.

| Service | Shape | Register as | Demonstrates |
|---|---|---|---|
| `notary` | sync | tier **T1**, verification `witness`/`sha256`, interaction `sync` | a trustlessly verifiable result (the worker re-hashes and compares, so you are paid only on a correct answer) |
| `async` | long-running | interaction `async` | return `{status:'working', handle}`; the worker polls the handle until you return `completed` |
| `elicit` | needs-input | interaction `human` (or `async`) | return `{status:'input_required', inputRequest}`; the buyer answers and the worker resumes with `kind:'answer'` |

## Run

```bash
# from packages/agent-sdk
SERVICE=notary npx tsx examples/reference-services/providers.ts   # :4210
SERVICE=async  npx tsx examples/reference-services/providers.ts   # :4211
SERVICE=elicit npx tsx examples/reference-services/providers.ts   # :4212
# or: npm run example:providers   (SERVICE defaults to notary)
```

Each serves `POST /` (fulfill) and `GET /health`. Point a CleverCon service
registration at the running URL with the tier/interaction shown above. See
`providers.ts` for the per-service `manifestHint` (input schema + verification).

A bare value returned from `fulfill` is treated as a completed sync delivery (so the
simplest service is a one-liner); return a `FulfillmentOutcome`
(`working`/`input_required`/`completed`/`failed`) to drive the async lifecycle.
Helpers `artifactRef`, `fetchAttachment`, and `sha256Hex` are exported for
file-bearing services.
