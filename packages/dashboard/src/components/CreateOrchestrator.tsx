import { useState } from 'react';
import { Layers, Sparkles, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { useOrchestrator } from '../contexts/OrchestratorProvider';

const EXAMPLE_NAMES = ['Phoenix', 'Atlas', 'Sage', 'Nova', 'Orion', 'Ember'];

export function CreateOrchestrator() {
  const { publicKey, signTransaction } = useWallet();
  const { refresh } = useOrchestrator();

  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [step, setStep] = useState<'form' | 'creating' | 'signing' | 'success'>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pubkey: string; name: string } | null>(null);

  const handleCreate = async () => {
    if (!publicKey || !name.trim()) return;
    setError(null);
    setStep('creating');

    try {
      // 1. Ask server to create the orchestrator keypair + fund via Friendbot
      const createRes = await fetch('/api/orchestrators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_address: publicKey,
          name: name.trim(),
          system_prompt: systemPrompt.trim() || undefined,
        }),
      });

      if (createRes.status === 409) {
        // Already exists — just refresh
        await refresh();
        return;
      }
      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || `Server error ${createRes.status}`);
      }

      const { orchestrator_pubkey, name: orchName, registration_xdr } = await createRes.json();

      // 2. If the contract is deployed, ask the user to sign the registration XDR
      if (registration_xdr) {
        setStep('signing');
        const signed = await signTransaction(registration_xdr, 'Test SDF Network ; September 2015');

        const confirmRes = await fetch('/api/orchestrators/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_address: publicKey, signed_xdr: signed }),
        });
        if (!confirmRes.ok) {
          const err = await confirmRes.json();
          throw new Error(err.error || 'On-chain registration failed');
        }
      }

      setResult({ pubkey: orchestrator_pubkey, name: orchName });
      setStep('success');

      // Reload orchestrator context so App.tsx transitions to Dashboard
      await refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
      setStep('form');
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (step === 'success' && result) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md text-center">
          <div className="w-14 h-14 bg-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">{result.name} is ready</h2>
          <p className="text-sm text-gray-400 mb-6">
            Your personal AI agent has been created on Stellar Testnet.
          </p>
          <div className="bg-gray-800 rounded-xl p-3 mb-4">
            <p className="text-xs text-gray-500 mb-1">Orchestrator wallet</p>
            <p className="text-xs font-mono text-gray-300 break-all">{result.pubkey}</p>
          </div>
          <a
            href={`https://stellar.expert/explorer/testnet/account/${result.pubkey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            View on stellar.expert <ExternalLink size={11} />
          </a>
          <p className="mt-6 text-xs text-gray-600">Redirecting to dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Creation in progress ───────────────────────────────────────────────────
  const isWorking = step === 'creating' || step === 'signing';
  const statusText =
    step === 'creating' ? `Creating ${name || 'your agent'}…` :
    step === 'signing'  ? 'Check Freighter to sign…' : '';

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
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-1">Create your AI agent</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Your agent will plan tasks, hire specialized agents, and pay them on Stellar.
            Give it a name.
          </p>
        </div>

        {/* Name input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Agent name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            disabled={isWorking}
            placeholder="e.g., Phoenix, Atlas, Sage, Nova…"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
          {/* Quick-pick names */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLE_NAMES.map((n) => (
              <button
                key={n}
                onClick={() => setName(n)}
                disabled={isWorking}
                className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:border-purple-600 hover:text-purple-400 transition-colors disabled:opacity-40"
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Optional personality */}
        <div className="mb-6">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
          >
            {showPrompt ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Add personality (optional)
          </button>
          {showPrompt && (
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={isWorking}
              rows={3}
              placeholder="e.g., Focus on research tasks. Always cite sources. Prefer cheaper agents."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none disabled:opacity-50"
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800/50 rounded-xl px-3 py-2 mb-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleCreate}
          disabled={!name.trim() || isWorking}
          className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors text-sm"
        >
          {isWorking ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {statusText}
            </>
          ) : (
            `Create ${name.trim() || 'Agent'}`
          )}
        </button>

        <p className="mt-4 text-center text-xs text-gray-600">
          A Stellar wallet will be created for your agent on testnet
        </p>
      </div>
    </div>
  );
}
