import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { config, isDemo } from '../config';
import { useSession } from '../store/session';
import { useToasts } from '../store/toasts';

/**
 * Subscribe to server-pushed updates over WebSocket (full mode only). The worker
 * emits `task.updated` when a job finishes and `job.paid` when a provider is paid;
 * the API emits `dispute.opened` / `dispute.resolved`. We refetch the affected
 * queries so the UI reflects it instantly instead of waiting for the poll. The
 * socket is authenticated with the access token and scoped to the user's room.
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
    const refreshProofs = () => qc.invalidateQueries({ queryKey: ['proof'] });
    // A provider got paid: refresh their earnings, jobs, and trust signals.
    const refreshProvider = () => {
      qc.invalidateQueries({ queryKey: ['provider-earnings'] });
      qc.invalidateQueries({ queryKey: ['provider-jobs'] });
      qc.invalidateQueries({ queryKey: ['provider-services'] });
    };
    // A dispute changed: refresh every dispute inbox plus tasks/activity.
    const refreshDisputes = () => {
      qc.invalidateQueries({ queryKey: ['disputes'] });
      qc.invalidateQueries({ queryKey: ['provider-disputes'] });
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
      refresh();
    };
    const toast = useToasts.getState().push;

    // Each server event refreshes the relevant data AND surfaces a visible toast,
    // so a payout / completion / dispute outcome is noticed, not just silently
    // refetched. Payloads are best-effort; guard every field.
    const onTask = (p?: { status?: string; settled?: boolean; finalized?: boolean }) => {
      refresh();
      if (p?.status === 'completed') toast({ kind: 'success', title: 'Job completed' });
      else if (p?.status === 'failed') toast({ kind: 'error', title: 'Job failed' });
      else if (p?.settled || p?.finalized)
        toast({ kind: 'success', title: 'Payment settled on-chain' });
    };
    const onPaid = (p?: { amountUsdc?: number; service?: string }) => {
      refreshProvider();
      toast({
        kind: 'success',
        title: 'You got paid',
        body:
          (typeof p?.amountUsdc === 'number' ? `$${p.amountUsdc.toFixed(2)} USDC` : 'Payment received') +
          (p?.service ? ` · ${p.service}` : ''),
      });
    };
    const onDisputeOpened = () => {
      refreshDisputes();
      toast({ kind: 'info', title: 'Dispute opened', body: 'A job you fulfilled was disputed.' });
    };
    const onDisputeResolved = (p?: { upheld?: boolean }) => {
      refreshDisputes();
      toast({
        kind: 'info',
        title: 'Dispute resolved',
        body: p?.upheld === true ? 'Refunded to the buyer.' : 'Settled to the provider.',
      });
    };
    socket.on('task.updated', onTask);
    socket.on('proof.updated', refreshProofs);
    socket.on('job.paid', onPaid);
    socket.on('dispute.opened', onDisputeOpened);
    socket.on('dispute.resolved', onDisputeResolved);
    return () => {
      socket.off('task.updated', onTask);
      socket.off('proof.updated', refreshProofs);
      socket.off('job.paid', onPaid);
      socket.off('dispute.opened', onDisputeOpened);
      socket.off('dispute.resolved', onDisputeResolved);
      socket.disconnect();
    };
  }, [token, qc]);
}
