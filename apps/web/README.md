# apps/web (planned — Phase 2)

The new React 19 + Vite SPA: buyer, service-provider, admin, and developer
consoles behind wallet sign-in and RBAC (React Router + TanStack Query +
Zustand + Radix/Tailwind), code-split per persona.

**Demo/backendless mode from day one** (`VITE_BACKEND=demo`): wallet + contracts
real, backend features mocked, so it deploys to Vercel free and keeps the review
site alive. `full` mode talks to `services/api`.

The current live review site is still served by `packages/dashboard`; Vercel is
cut over to `apps/web` only once it reaches parity. Do not break the live site.

Status: not yet scaffolded. See `.local/PRODUCTION-ROADMAP.md` (Phase 2).
