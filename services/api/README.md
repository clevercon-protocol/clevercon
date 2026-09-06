# services/api (planned — Phase 1)

NestJS API: the stateless application backend. Domain modules (auth, accounts,
marketplace, tasks, policy, providers, disputes, admin, developer/api-keys),
RBAC guards, validation pipes, and a WebSocket gateway (Redis-backed).

Reads/writes Postgres via `packages/db` (Prisma). Enqueues slow/at-risk work to
`services/workers` via BullMQ. Never holds signing keys on disk (KMS / encrypted
at rest).

Status: not yet scaffolded. See `.local/PRODUCTION-ROADMAP.md` (Phase 1) and
`.local/PROGRESS.md`.
