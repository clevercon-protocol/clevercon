import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Shell } from './components/Shell';
import { RequireAuth } from './components/RequireAuth';
import { Landing } from './pages/Landing';
import { Connect } from './pages/Connect';
import { Buyer } from './pages/Buyer';
import { TaskDetail } from './pages/TaskDetail';
import { ServiceDetail } from './pages/ServiceDetail';
import { Provider } from './pages/Provider';
import { Admin } from './pages/Admin';
import { Developer } from './pages/Developer';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
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
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
