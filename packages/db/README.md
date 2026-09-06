# packages/db (planned — Phase 1)

Prisma schema + generated client, shared by `services/api`, `services/indexer`,
and `services/workers`. Postgres is the queryable, reconciled mirror of on-chain
state (on-chain remains source of truth for money).

Tables (highlights): users, roles, sessions, api_keys, wallets, vault_accounts,
services, service_reputation, tasks, task_steps, payments, policies, proofs,
disputes, settlements, events, webhooks, audit_log.

Status: schema design pending (Phase 0/1). See `.local/PRODUCTION-ROADMAP.md`.
