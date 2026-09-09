import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Wallet, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { isDemo } from '../config';
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
    <section className="mx-auto max-w-md py-12">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center shadow-xl shadow-black/20">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-700 shadow-lg shadow-violet-900/40">
          <Layers size={22} className="text-white" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-white">Connect your wallet</h1>
        <p className="mt-2 text-sm text-slate-400">
          {isDemo()
            ? 'Demo mode: connects a sample session, no wallet or keys needed.'
            : 'Sign in with your Stellar wallet (SEP-10). You approve a one-time signature, no funds move.'}
        </p>

        <button
          onClick={connect}
          disabled={busy}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all"
        >
          <Wallet size={16} />
          {busy ? 'Connecting…' : 'Connect wallet'}
        </button>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-center gap-x-5 gap-y-1 flex-wrap text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-500/80" /> Non-custodial
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-500/80" /> Stellar testnet
          </span>
        </div>
      </div>
    </section>
  );
}
