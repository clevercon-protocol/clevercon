# @clevercon/web (apps/web)

The next-generation CleverCon SPA (React 19 + Vite + React Router + TanStack Query
+ Zustand + Tailwind). Role-aware shell for Buyer / Provider / Admin / Developer
consoles behind wallet sign-in.

**Demo mode by default** (`VITE_BACKEND=demo`): no backend or wallet needed, so it
deploys to Vercel free and keeps the review site alive. `full` mode talks to
`services/api`. The current live site is still `packages/dashboard`; Vercel is cut
over to `apps/web` only once it reaches parity.

## Run

```bash
npm run dev -w @clevercon/web     # http://localhost:5173 (demo mode)
npm run build -w @clevercon/web   # typecheck + production build
```

Status: scaffold. Role-aware routing, demo sign-in, placeholder consoles. Buyer
flow (vault, adaptive hire, marketplace) is next. See .local/PROGRESS.md.
