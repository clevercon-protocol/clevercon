import { useState } from 'react';
import { isDemo } from '../config';
import { useSession, type Role } from '../store/session';

const DEMO_ADDRESS = 'GDEMOBUYERPROVIDER0000000000000000000000000000000000000DEMO';

/**
 * Sign-in flow. Demo mode (the default, and what the free Vercel deploy uses)
 * sets a mock session with no backend. Full mode connects a real wallet and
 * runs the /auth challenge/verify flow (wired in a later increment).
 */
export function useWalletAuth() {
  const setSession = useSession((s) => s.setSession);
  const clear = useSession((s) => s.clear);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (isDemo()) {
        setSession({
          address: DEMO_ADDRESS,
          roles: ['BUYER', 'PROVIDER'] as Role[],
          accessToken: null,
          refreshToken: null,
        });
        return;
      }
      throw new Error(
        'Full-mode wallet sign-in is not wired yet. Run in demo mode (VITE_BACKEND=demo).',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { connect, disconnect: clear, busy, error };
}
