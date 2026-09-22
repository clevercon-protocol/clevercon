import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Shell } from './components/Shell';
import { RequireAuth } from './components/RequireAuth';
// Landing and Connect are the entry path, so they stay in the main bundle.
import { Landing } from './pages/Landing';
import { Connect } from './pages/Connect';
import { Placeholder } from './pages/Placeholder';

// Persona consoles are code-split: each loads only when its route is visited.
const lazyFrom = <T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  key: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[key] })));

const BuyerLayout = lazyFrom(() => import('./pages/buyer/BuyerLayout'), 'BuyerLayout');
const Home = lazyFrom(() => import('./pages/buyer/home'), 'Home');
const LimitsPage = lazyFrom(() => import('./pages/buyer/LimitsPage'), 'LimitsPage');
const VaultPage = lazyFrom(() => import('./pages/buyer/VaultPage'), 'VaultPage');
const ServicesPage = lazyFrom(() => import('./pages/buyer/ServicesPage'), 'ServicesPage');
const ActivityPage = lazyFrom(() => import('./pages/buyer/ActivityPage'), 'ActivityPage');
const TaskDetail = lazyFrom(() => import('./pages/TaskDetail'), 'TaskDetail');
const ServiceDetail = lazyFrom(() => import('./pages/ServiceDetail'), 'ServiceDetail');
const Provider = lazyFrom(() => import('./pages/Provider'), 'Provider');
const Admin = lazyFrom(() => import('./pages/Admin'), 'Admin');
const Developer = lazyFrom(() => import('./pages/Developer'), 'Developer');

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

              {/* Buyer console: a layout with secondary nav and focused sub-pages. */}
              <Route
                path="/app"
                element={
                  <RequireAuth role="BUYER">
                    <BuyerLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Home />} />
                <Route path="limits" element={<LimitsPage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="vault" element={<VaultPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="tasks/:id" element={<TaskDetail />} />
                <Route path="marketplace/:id" element={<ServiceDetail />} />
                {/* Chat-first rework: hire lives in Home; browse in /app/services; limits in /app/limits. */}
                <Route path="hire" element={<Navigate to="/app" replace />} />
                <Route path="jobs" element={<Navigate to="/app/activity" replace />} />
                <Route path="marketplace" element={<Navigate to="/app/services" replace />} />
                <Route path="policies" element={<Navigate to="/app/limits" replace />} />
              </Route>

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
