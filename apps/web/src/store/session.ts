import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'BUYER' | 'PROVIDER' | 'ADMIN' | 'DEVELOPER';

export interface Session {
  address: string;
  roles: Role[];
  accessToken: string | null;
  refreshToken: string | null;
}

interface SessionState {
  session: Session | null;
  setSession: (s: Session) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      clear: () => set({ session: null }),
    }),
    { name: 'clevercon.session' },
  ),
);
