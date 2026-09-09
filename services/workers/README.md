# `@clevercon/workers`

The BullMQ worker layer (Phase 1 scalable core). Slow or at-risk work, task
execution, and later proof jobs and settlement, runs here off the request path,
with retries, backoff, and idempotency, so the API stays stateless and fast.

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

On-chain payment/settlement per released step (x402 / vault release) is a
separate job, not done here, so no `Payment` rows are fabricated.

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
