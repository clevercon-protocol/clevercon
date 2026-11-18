# @clevercon/db

Prisma schema + shared client for the new stack (`services/api`, `services/indexer`,
`services/workers`). Postgres is the queryable, reconciled **mirror** of on-chain
state; the chain remains source of truth for money. Amounts are `Decimal(20,7)`
in USDC units.

## Run it locally (any OS: Docker + Node)

From the repo root:

```bash
npm install            # installs workspace deps incl. Prisma
npm run setup          # copies .env, starts Postgres+Redis, generates client, migrates, seeds
```

Or step by step:

```bash
npm run db:up          # docker compose: Postgres + Redis
npm run db:generate    # prisma generate
npm run db:push        # sync schema to the local DB (no migration files; used by setup)
npm run db:seed        # demo user + sample services (no keys needed)
npm run db:studio      # browse the data
```

`db:push` is for fast local dev. Authored, reproducible migrations come later via
`npm run db:migrate` (prisma migrate dev) and `migrate:deploy` in production.

## No Docker? Use an existing local Postgres

`npm run setup` tolerates a missing Docker daemon. If you already have Postgres
running, point `DATABASE_URL` in `.env` at it and run `npm run db:generate &&
npm run db:push && npm run db:seed`. A unix-socket URL with a dedicated schema
works without creating a database, e.g.:

```
DATABASE_URL=postgresql://<user>@localhost/<db>?host=/var/run/postgresql&schema=clevercon
```

The package builds to `dist` (consumed by services at runtime); `postinstall`
runs `db:generate` + `db:build` so the client and JS output are always present.

## Model overview

Identity/auth (`users`, `wallets`, `user_roles`, `auth_challenges`, `sessions`,
`api_keys`), vault mirror (`vault_accounts`), marketplace (`services`,
`service_reputation`), execution (`tasks`, `task_steps`), money (`payments`,
`settlements`), privacy (`policies`, `proofs`), `disputes`, indexer
(`chain_events`), `webhooks`, `audit_logs`.

See `.local/PRODUCTION-ROADMAP.md` and `.local/PROGRESS.md` for context.
