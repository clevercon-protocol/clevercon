# @clevercon/api (services/api)

NestJS API: the stateless application backend. Modular by domain, with RBAC
guards, typed fail-fast config, a WebSocket gateway (Redis-backed), and Prisma
via `@clevercon/db`. Slow/at-risk work is offloaded to `services/workers`.

## Status

Skeleton up: typed config validation, Prisma integration, and a health endpoint.
Auth (wallet sign-in + JWT/refresh + RBAC + API keys) and domain modules land
next. See `.local/PROGRESS.md`.

## Run locally

```bash
# from repo root: bring up Postgres + Redis first
npm run db:up
# then, in services/api
npm run dev        # nest start --watch (swc)
curl localhost:4100/health   # { status: "ok", db: "up", ... }
```

Config is validated at boot (`src/config/env.validation.ts`); the app refuses to
start with an invalid `.env` and prints exactly what is wrong.

## Test

```bash
npm test           # vitest (from repo root runs all workspaces)
```
