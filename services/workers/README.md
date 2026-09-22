# `@clevercon/workers`

The BullMQ worker layer. Slow or at-risk work runs here off the request path with
retries, backoff, and idempotency, so the API stays fast: **task execution**
(hires), **proof generation**, and **exactly-once settlement** (the on-chain budget
lock, proof-gated release, and finalization), all signed by the user's delegate.

## Task-execution worker

- **Producer:** the API enqueues a job when a buyer starts a DIRECT hire
  (`QueueService.enqueueTaskExecution`). The job id is derived from the task id,
  so the same task is never queued twice concurrently.
- **Consumer (`src/index.ts`):** a BullMQ `Worker` on the `task-execution` queue
  that runs `executeTask`: mark the task `RUNNING`, call each step's provider
  endpoint (HTTP), record the output/latency and mark the step `RELEASED`, or
  `FAILED` with the error, then settle the task to `COMPLETED`/`FAILED`.
  Idempotent (released steps and terminal tasks are skipped), so BullMQ retries
  never double-execute.

## Settlement worker

- **Producer:** the API (`enqueueSettlement`) enqueues one job per released step of
  a pay/disburse; the executor enqueues one per released hire step. The job id is the
  step id, so a step is never settled twice.
- **Consumer (`src/settlement.ts`):** as the user's delegate, lock the task budget
  on-chain lazily on the first step to settle (the async lock, inside a per-signer
  mutex so a signer's transactions never race the sequence number), then
  `release_payment_proved` the step (proof-gated, paid directly to the payee) and
  record a `Payment` mirror **only after a real on-chain release**, never fabricated.
  Idempotent by (task, step) plus a unique mirror key; transient failures retry with
  backoff, deterministic ones fail the task fast. Once every released step has
  settled, `finalizeTaskIfComplete` calls `complete_task` to unlock the remainder and
  refund, and notifies the buyer's webhooks.

## Proof-generation worker

Builds the policy inputs and binding proof for a release (`src/prover.ts`); that
proof is submitted with `release_payment_proved` and checked on-chain by the
PolicyVerifier before any funds move.

## Run

```bash
# needs Redis (docker compose up -d redis) and DATABASE_URL/REDIS_URL in .env
npm run -w @clevercon/workers start      # start the worker
WORKER_CONCURRENCY=5                      # optional (default 5)
```

## Test

```bash
npm test                                  # executor unit tests (mock prisma+fetch)
REDIS_URL=redis://127.0.0.1:6379 npm test # + the real-Redis queue round-trip
```

Config: `REDIS_URL` (default `redis://127.0.0.1:6379`), `DATABASE_URL`,
`WORKER_CONCURRENCY`. The queue name (`task-execution`) and job shape must match
the API producer in `services/api/src/queue/queue.service.ts`.
