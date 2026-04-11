import { useState } from 'react';
import { X, Copy, Check, ExternalLink, Bot, Shield, Cpu, Pencil } from 'lucide-react';
import { useWallets } from '../hooks/useWallets';
import { useOrchestrator } from '../contexts/OrchestratorProvider';
import { useWallet } from '../contexts/WalletProvider';
import { renameOrchestrator } from '../lib/api';

interface Props {
  name: string;
  pubkey: string;
  registered: boolean;
  onClose: () => void;
}

const EXPLORER = 'https://stellar.expert/explorer/testnet/account';

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-gray-600 hover:text-gray-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  );
}

export function BotDetailsModal({ name, pubkey, registered, onClose }: Props) {
  const balances = useWallets([{ address: pubkey, label: name }]);
  const bal = balances[0];
  const { refresh } = useOrchestrator();
  const { publicKey } = useWallet();

  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(name);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState('');

  const handleRename = async () => {
    const trimmed = renameVal.trim();
    if (!trimmed || trimmed === name) { setRenaming(false); return; }
    if (!publicKey) return;
    setSaving(true);
    setRenameError('');
    try {
      await renameOrchestrator(publicKey, trimmed);
      await refresh();
      setRenaming(false);
    } catch (err: any) {
      setRenameError(err.message ?? 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-800">
          <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-600/30 flex items-center justify-center shrink-0">
            <Bot size={18} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                  className="flex-1 bg-gray-800 border border-purple-600/50 rounded-lg px-2 py-1 text-sm text-white outline-none"
                />
                <button onClick={handleRename} disabled={saving}
                  className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-40">
                  <Check size={13} />
                </button>
                <button onClick={() => { setRenaming(false); setRenameVal(name); setRenameError(''); }}
                  className="p-1 text-gray-600 hover:text-gray-400">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white truncate">{name}</p>
                <button onClick={() => { setRenameVal(name); setRenaming(true); }}
                  className="p-0.5 text-gray-700 hover:text-gray-400 transition-colors" title="Rename">
                  <Pencil size={11} />
                </button>
              </div>
            )}
            {renameError && <p className="text-xs text-red-400 mt-0.5">{renameError}</p>}
            {!renaming && (
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <Cpu size={9} />
                AI Orchestrator · Stellar Testnet
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Address */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5 uppercase tracking-wider font-medium">Stellar Address</p>
            <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2.5">
              <span className="text-xs font-mono text-gray-400 flex-1 truncate">{pubkey}</span>
              <CopyBtn text={pubkey} />
              <a href={`${EXPLORER}/${pubkey}`} target="_blank" rel="noopener noreferrer"
                className="text-gray-600 hover:text-blue-400 transition-colors">
                <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {/* Balances */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5 uppercase tracking-wider font-medium">Balances</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-xs text-gray-600 mb-0.5">XLM</p>
                <p className="text-sm font-mono font-bold text-emerald-400">
                  {bal?.loading ? '…' : bal?.xlm ?? '—'}
                </p>
              </div>
              <div className="bg-gray-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-xs text-gray-600 mb-0.5">USDC</p>
                <p className="text-sm font-mono font-bold text-blue-400">
                  {bal?.loading ? '…' : (bal?.usdc ?? 'no trustline')}
                </p>
              </div>
            </div>
          </div>

          {/* Registration */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800/60 border border-gray-800">
            <Shield size={11} className={registered ? 'text-emerald-400' : 'text-gray-600'} />
            <span className="text-xs text-gray-400">
              {registered ? 'Registered on-chain' : 'Not yet registered on-chain'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
