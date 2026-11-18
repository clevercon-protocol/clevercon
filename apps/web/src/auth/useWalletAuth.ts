import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isDemo } from '../config';
import { useSession, type Role } from '../store/session';
import { apiPost } from '../lib/api';
import { connectWallet, signTransaction, clearSelectedWallet } from '../lib/wallet';

const DEMO_ADDRESS = 'GDEMOBUYERPROVIDER0000000000000000000000000000000000000DEMO';

interface ChallengeResp {
  transaction: string;
  networkPassphrase: string;
}
interface VerifyResp {
  accessToken: string;
  refreshToken: string;
  roles: Role[];
}

/**
 * Sign-in flow. Demo mode (default, the backendless preview build) sets a
 * mock session with no backend. Full mode connects a real wallet and runs the
 * SEP-10 flow against /auth: challenge -> signTransaction -> verify.
 */
export function useWalletAuth() {
  const setSession = useSession((s) => s.setSession);
  const clear = useSession((s) => s.clear);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    // Drop any cached data from a previous wallet so one account never shows
    // another's vault, policies, or activity in the same browser.
    qc.clear();
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
      const { address } = await connectWallet();
      const challenge = await apiPost<ChallengeResp>('/auth/challenge', { address });
      const signed = await signTransaction(challenge.transaction, challenge.networkPassphrase);
      const bundle = await apiPost<VerifyResp>('/auth/verify', { transaction: signed });
      setSession({
        address,
        roles: bundle.roles,
        accessToken: bundle.accessToken,
        refreshToken: bundle.refreshToken,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const disconnect = () => {
    clearSelectedWallet();
    clear();
    qc.clear(); // purge the previous user's cached vault/policies/activity
  };

  return { connect, disconnect, busy, error };
}
