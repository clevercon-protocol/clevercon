# @clevercon/indexer (services/indexer)

Soroban event indexer. Polls the configured contracts (CleverVault, policy-verifier,
registry) via Soroban RPC, normalizes each event, and writes it to `chain_events`
in Postgres so the app reads the DB on the hot path instead of the chain. Resume
cursors are stored in `indexer_state`; inserts dedupe on the event cursor.

## Status

Core in place: event decoding (`events.ts`), idempotent persistence + cursor
tracking (`indexer.ts`), and a poll loop (`index.ts`). Rich projections (e.g.
updating `vault_accounts` from deposit/release events) are the next step and need
the exact vault event schema.

## Run locally

```bash
# from repo root: DB up + schema applied
npm run db:up && npm run db:push
INDEXER_CONTRACT_IDS=CC4QX7ZVME7PO25GELU5VIM6BOSU7UBNJF56D46VMGBWQBBFQVIXYRZO \
INDEXER_START_LEDGER=<recent-ledger> \
DATABASE_URL=postgresql://clevercon:clevercon@localhost:5432/clevercon \
npm start -w @clevercon/indexer
```

## Test

Pure decode/jsonSafe tests run anywhere; persistence is integration-tested
against a live Postgres (gated on `TEST_DATABASE_URL`). See `.local/PROGRESS.md`.
