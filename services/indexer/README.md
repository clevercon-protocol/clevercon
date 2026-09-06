# services/indexer (planned — Phase 1)

Soroban event indexer. Subscribes to CleverVault / policy-verifier / registry
contract events and writes them to Postgres so the app reads the DB on the hot
path instead of polling Horizon/RPC. Handles cursors, gaps, and reorg-safety.

Status: not yet scaffolded. See `.local/PRODUCTION-ROADMAP.md` (Phase 1).
