import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession, type Role } from '../store/session';

export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const session = useSession((s) => s.session);
  if (!session) return <Navigate to="/connect" replace />;
  if (role && !session.roles.includes(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
