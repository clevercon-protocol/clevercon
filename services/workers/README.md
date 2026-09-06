# services/workers (planned — Phase 1)

BullMQ workers for slow or at-risk work: task/step execution, ZK proof
generation, and settlement/reconciliation. Retries with backoff, idempotency
keys on all money mutations, restart-safe state. Signing happens here with
KMS-held / encrypted-at-rest keys, never on disk in plaintext.

Status: not yet scaffolded. See `.local/PRODUCTION-ROADMAP.md` (Phase 1).
