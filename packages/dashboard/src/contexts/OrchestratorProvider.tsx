/**
 * OrchestratorProvider — loads and exposes the user's personal orchestrator.
 *
 * Polls GET /api/orchestrators/:pubkey on mount (after wallet connection).
 * All components that need the orchestrator name or pubkey read from this context.
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useWallet } from './WalletProvider';

export interface OrchestratorInfo {
  name: string;
  pubkey: string;
  registered_on_chain: boolean;
  system_prompt: string | null;
}

interface OrchestratorContextValue {
  orchestrator: OrchestratorInfo | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const { publicKey } = useWallet();
  const [orchestrator, setOrchestrator] = useState<OrchestratorInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!publicKey) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/orchestrators/${encodeURIComponent(publicKey)}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (!data.exists) {
        // Server lost the record (redeploy). Try to restore from localStorage.
        const stored = localStorage.getItem(`clevercon_orchestrator_${publicKey}`);
        if (stored) {
          try {
            const record = JSON.parse(stored);
            const restoreRes = await fetch('/api/orchestrators/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(record),
            });
            if (restoreRes.ok) {
              // Re-fetch now that server knows about it
              const res2 = await fetch(`/api/orchestrators/${encodeURIComponent(publicKey)}`);
              const data2 = await res2.json();
              if (data2.exists) {
                setOrchestrator({
                  name: data2.name,
                  pubkey: data2.pubkey,
                  registered_on_chain: data2.registered_on_chain,
                  system_prompt: data2.system_prompt,
                });
                return;
              }
            }
          } catch { /* fall through to null */ }
        }
        setOrchestrator(null);
        return;
      }

      setOrchestrator({
        name: data.name,
        pubkey: data.pubkey,
        registered_on_chain: data.registered_on_chain,
        system_prompt: data.system_prompt,
      });
    } catch {
      setOrchestrator(null);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => { load(); }, [load]);

  return (
    <OrchestratorContext.Provider value={{ orchestrator, isLoading, refresh: load }}>
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOrchestrator() {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) throw new Error('useOrchestrator must be used within OrchestratorProvider');
  return ctx;
}
