# @clevercon/web (apps/web)

The next-generation CleverCon SPA (React 19 + Vite + React Router + TanStack Query
+ Zustand + Tailwind). Role-aware shell for Buyer / Provider / Admin / Developer
consoles behind wallet sign-in.

**Demo mode** (`VITE_BACKEND=demo`): no backend or wallet needed, so it deploys
free (Cloudflare Pages) as a public preview. `full` mode talks to `services/api`.

## Run

```bash
npm run dev -w @clevercon/web     # http://localhost:5173 (demo mode)
npm run build -w @clevercon/web   # typecheck + production build
```

This is the production frontend: role-aware routing, wallet sign-in, and the
Buyer / Provider / Admin / Developer consoles. See .local/PROGRESS.md for status.
