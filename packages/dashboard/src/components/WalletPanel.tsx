import { useState } from 'react';
import { Wallet, ExternalLink, RefreshCw, Plus, Copy, Check } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { useWallets } from '../hooks/useWallets';
import { fetchUsdcTrustlineXdr, submitUsdcTrustlineXdr } from '../lib/api';

const EXPLORER = 'https://stellar.expert/explorer/testnet/account';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-gray-700 hover:text-gray-400 transition-colors"
      title="Copy address"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
}

export function WalletPanel() {
  const { publicKey, signTransaction } = useWallet();
  const [addingUsdc, setAddingUsdc] = useState(false);
  const [usdcError, setUsdcError] = useState<string | null>(null);

  const wallets = publicKey ? [{ address: publicKey, label: 'Your Wallet' }] : [];
  const [bal] = useWallets(wallets);

  const needsTrustline = bal && !bal.loading && !bal.error && bal.usdc === null;

  const handleAddUsdc = async () => {
    if (!publicKey) return;
    setAddingUsdc(true);
    setUsdcError(null);
    try {
      const xdr = await fetchUsdcTrustlineXdr(publicKey);
      const signed = await signTransaction(xdr, 'Test SDF Network ; September 2015');
      await submitUsdcTrustlineXdr(signed);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      setUsdcError(/declined|rejected|denied|cancel/i.test(msg)
        ? 'Transaction rejected. Try again when ready.'
        : msg.slice(0, 100));
    } finally {
      setAddingUsdc(false);
    }
  };

  if (!publicKey) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Wallet size={14} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-gray-200">Your Wallet</h2>
        <span className="text-xs text-gray-600 ml-auto">Testnet</span>
      </div>

      <div className="px-4 py-3">
        {/* Address row */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-xs font-mono text-gray-600 flex-1 truncate">
            {publicKey.slice(0, 6)}…{publicKey.slice(-4)}
          </span>
          <CopyButton text={publicKey} />
          <a
            href={`${EXPLORER}/${publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-700 hover:text-gray-400 transition-colors"
          >
            <ExternalLink size={10} />
          </a>
        </div>

        {/* Balances */}
        {bal?.loading ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-700">
            <RefreshCw size={9} className="animate-spin" />
            <span>Loading…</span>
          </div>
        ) : bal?.error ? (
          <p className="text-xs text-red-500">Failed to load balances</p>
        ) : (
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-600 mb-0.5">XLM</p>
              <p className="text-sm font-mono font-bold text-emerald-400">{bal?.xlm ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-0.5">USDC</p>
              {bal?.usdc !== null
                ? <p className="text-sm font-mono font-bold text-blue-400">{bal?.usdc}</p>
                : <p className="text-xs text-gray-600 italic">No trustline</p>
              }
            </div>
          </div>
        )}

        {/* Add USDC trustline */}
        {needsTrustline && (
          <div className="mt-3">
            {usdcError && <p className="text-xs text-red-400 mb-1.5">{usdcError}</p>}
            <button
              onClick={handleAddUsdc}
              disabled={addingUsdc}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-950/30 hover:bg-blue-950/50 border border-blue-900/50 rounded-xl px-3 py-2 transition-all disabled:opacity-50"
            >
              {addingUsdc ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
              {addingUsdc ? 'Adding…' : 'Add USDC Trustline'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
