import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletAuth } from '../auth/useWalletAuth';
import { useSession } from '../store/session';

export function Connect() {
  const { connect, busy, error } = useWalletAuth();
  const session = useSession((s) => s.session);
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate('/app', { replace: true });
  }, [session, navigate]);

  return (
    <section className="max-w-md mx-auto py-16 text-center">
      <h1 className="text-2xl font-bold">Connect your wallet</h1>
      <p className="mt-2 text-slate-400">Sign in with your Stellar wallet to continue.</p>
      <button
        onClick={connect}
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-5 py-3 font-semibold"
      >
        {busy ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </section>
  );
}
