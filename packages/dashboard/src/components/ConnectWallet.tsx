import { useState, useEffect } from 'react';
import { Layers, Wallet, Shield, Zap, Globe, ExternalLink, ChevronRight, Download } from 'lucide-react';
import { useWallet, type ISupportedWallet } from '../contexts/WalletProvider';

function WalletCard({
  wallet,
  onSelect,
  loading,
}: {
  wallet: ISupportedWallet;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={() => wallet.isAvailable && onSelect(wallet.id)}
      disabled={loading || !wallet.isAvailable}
      className={[
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left',
        wallet.isAvailable
          ? 'border-gray-700 bg-gray-800/60 hover:border-purple-600/60 hover:bg-gray-800 active:scale-[0.99] cursor-pointer'
          : 'border-gray-800/50 bg-gray-800/20 opacity-50 cursor-not-allowed',
      ].join(' ')}
    >
      <img
        src={wallet.icon}
        alt={wallet.name}
        className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200 leading-none">{wallet.name}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-none">
          {wallet.isAvailable ? 'Ready to connect' : 'Not installed'}
        </p>
      </div>
      {wallet.isAvailable ? (
        <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />
      ) : (
        <a
          href={wallet.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-purple-400 transition-colors flex-shrink-0"
        >
          <Download size={12} />
        </a>
      )}
    </button>
  );
}

export function ConnectWallet() {
  const { connect, isLoading, getSupportedWallets } = useWallet();
  const [wallets, setWallets]       = useState<ISupportedWallet[]>([]);
  const [scanning, setScanning]     = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The kit races each wallet's isAvailable() against a 500 ms timeout.
    // Freighter (and some other extensions) inject into window asynchronously
    // and can lose that race on first page load. We poll a few times so that
    // by the time the extension has finished injecting we pick it up.
    const refresh = async () => {
      try {
        const list = await getSupportedWallets();
        if (!cancelled) setWallets(list);
      } catch {
        if (!cancelled) setWallets([]);
      }
    };

    // First pass — immediate (catches wallets that are already ready)
    refresh().finally(() => { if (!cancelled) setScanning(false); });

    // Second pass — 800 ms: extension may have injected by now
    const t1 = setTimeout(refresh, 800);
    // Third pass — 2 s: last-chance for slower extension startup
    const t2 = setTimeout(refresh, 2000);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const handleSelect = async (id: string) => {
    setError(null);
    setConnecting(id);
    try {
      await connect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(null);
    }
  };

  const available   = wallets.filter(w => w.isAvailable);
  const unavailable = wallets.filter(w => !w.isAvailable);
  const busy        = isLoading || !!connecting;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
          <Layers size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white leading-none">CleverCon</h1>
          <p className="text-xs text-gray-500 leading-none mt-1">AI Agent Marketplace · Stellar Testnet</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-10 h-10 bg-purple-900/50 border border-purple-800/50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Wallet size={18} className="text-purple-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-1.5">Connect your wallet</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Choose a Stellar wallet to access CleverCon. Your funds stay in your control.
          </p>
        </div>

        {/* Wallet list */}
        <div className="space-y-2 mb-6">
          {scanning ? (
            <div className="py-8 text-center">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-gray-500 mt-2">Detecting wallets…</p>
            </div>
          ) : wallets.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs text-gray-500">No Stellar wallets found.</p>
            </div>
          ) : (
            <>
              {/* Available wallets */}
              {available.map(w => (
                <WalletCard
                  key={w.id}
                  wallet={w}
                  onSelect={handleSelect}
                  loading={busy}
                />
              ))}

              {/* Not-installed wallets */}
              {unavailable.length > 0 && (
                <>
                  {available.length > 0 && (
                    <p className="text-xs text-gray-700 pt-1 pb-0.5 px-1">Not installed</p>
                  )}
                  {unavailable.map(w => (
                    <WalletCard
                      key={w.id}
                      wallet={w}
                      onSelect={handleSelect}
                      loading={busy}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800/50 rounded-xl px-3 py-2.5 mb-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Features */}
        <div className="space-y-2.5 pt-4 border-t border-gray-800">
          {[
            { icon: Shield, title: 'Trustless treasury', desc: 'Your USDC held by CleverVault, not us.' },
            { icon: Zap,    title: 'Personal AI agent',  desc: 'Name your orchestrator and hire specialists.' },
            { icon: Globe,  title: 'On-chain transparency', desc: 'Every payment verifiable on stellar.expert.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-2.5">
              <div className="w-6 h-6 bg-purple-900/40 border border-purple-800/40 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon size={11} className="text-purple-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-300">{title}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-amber-600/80 font-medium">
          Make sure your wallet is set to Stellar Testnet
        </p>
      </div>

      <p className="mt-6 text-xs text-gray-700">
        Powered by Stellar · Testnet
      </p>
    </div>
  );
}
