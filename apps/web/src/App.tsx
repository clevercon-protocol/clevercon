import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Shell } from './components/Shell';
import { RequireAuth } from './components/RequireAuth';
// Landing and Connect are the entry path, so they stay in the main bundle.
import { Landing } from './pages/Landing';
import { Connect } from './pages/Connect';
import { Placeholder } from './pages/Placeholder';

// Persona consoles are code-split: each loads only when its route is visited.
const Buyer = lazy(() => import('./pages/Buyer').then((m) => ({ default: m.Buyer })));
const TaskDetail = lazy(() =>
  import('./pages/TaskDetail').then((m) => ({ default: m.TaskDetail })),
);
const ServiceDetail = lazy(() =>
  import('./pages/ServiceDetail').then((m) => ({ default: m.ServiceDetail })),
);
const Provider = lazy(() => import('./pages/Provider').then((m) => ({ default: m.Provider })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Developer = lazy(() => import('./pages/Developer').then((m) => ({ default: m.Developer })));

function RouteFallback() {
  return <p className="text-sm text-slate-500">Loading…</p>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/connect" element={<Connect />} />
              <Route
                path="/app"
                element={
                  <RequireAuth role="BUYER">
                    <Buyer />
                  </RequireAuth>
                }
              />
              <Route
                path="/app/tasks/:id"
                element={
                  <RequireAuth role="BUYER">
                    <TaskDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/app/marketplace/:id"
                element={
                  <RequireAuth role="BUYER">
                    <ServiceDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/provider"
                element={
                  // Self-serve: any signed-in user can register a service here,
                  // which grants the PROVIDER role.
                  <RequireAuth>
                    <Provider />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAuth role="ADMIN">
                    <Admin />
                  </RequireAuth>
                }
              />
              <Route
                path="/developers"
                element={
                  // Self-serve: any signed-in user can get API access here.
                  // Creating a key grants the DEVELOPER role.
                  <RequireAuth>
                    <Developer />
                  </RequireAuth>
                }
              />
              <Route
                path="*"
                element={<Placeholder title="Not found" blurb="That page does not exist." />}
              />
            </Routes>
          </Suspense>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
