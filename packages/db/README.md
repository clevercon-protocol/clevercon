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
npm run db:migrate     # prisma migrate dev
npm run db:seed        # demo user + sample services (no keys needed)
npm run db:studio      # browse the data
```

## Model overview

Identity/auth (`users`, `wallets`, `user_roles`, `auth_challenges`, `sessions`,
`api_keys`), vault mirror (`vault_accounts`), marketplace (`services`,
`service_reputation`), execution (`tasks`, `task_steps`), money (`payments`,
`settlements`), privacy (`policies`, `proofs`), `disputes`, indexer
(`chain_events`), `webhooks`, `audit_logs`.

See `.local/PRODUCTION-ROADMAP.md` and `.local/PROGRESS.md` for context.
