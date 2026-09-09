import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { config, isDemo } from '../config';
import { useSession } from '../store/session';

/**
 * Subscribe to server-pushed updates over WebSocket (full mode only). The worker
 * emits `task.updated` when a job finishes; we refetch the affected queries so
 * the UI reflects it instantly instead of waiting for the poll. The socket is
 * authenticated with the access token and scoped to the user's room server-side.
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  const token = useSession((s) => s.session?.accessToken ?? null);

  useEffect(() => {
    if (isDemo() || !token) return;
    const socket = io(config.apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['vault'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    };
    socket.on('task.updated', refresh);
    return () => {
      socket.off('task.updated', refresh);
      socket.disconnect();
    };
  }, [token, qc]);
}
