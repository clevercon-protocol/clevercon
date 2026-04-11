import { useState } from 'react';
import { PlusCircle, Check, AlertCircle, RefreshCw, Wallet, ExternalLink, Copy } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';

const REGISTRY_URL = 'http://localhost:4000';

const EMPTY_FORM = {
  agent_id: '',
  name: '',
  description: '',
  capabilities: '',
  payment_model: 'x402',
  price_per_call: '0.02',
  endpoint: '',
  stellar_address: '',
  health_check: '',
  provision_wallet: false,
};

function validateForm(form: typeof EMPTY_FORM): string | null {
  if (!form.agent_id.match(/^[a-z0-9-]+$/))
    return 'Agent ID must be lowercase letters, numbers, and hyphens only';
  if (!form.name.trim()) return 'Display name is required';
  if (!form.endpoint.startsWith('http'))
    return 'Endpoint must be a valid URL starting with http(s)://';
  if (!form.provision_wallet && !form.stellar_address.match(/^G[A-Z0-9]{55}$/))
    return 'Stellar address must start with G and be 56 characters';
  if (!form.capabilities.trim()) return 'At least one capability is required';
  const price = parseFloat(form.price_per_call);
  if (isNaN(price) || price <= 0) return 'Price must be a positive number';
  return null;
}

interface ProvisionedWallet {
  publicKey: string;
  secretKey: string;
  explorerUrl: string;
  txHash: string;
}

export function RegisterAgent() {
  const { publicKey } = useWallet();
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<'idle' | 'provisioning' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [provisioned, setProvisioned] = useState<ProvisionedWallet | null>(null);
  const [copied, setCopied] = useState(false);

  const update = (key: string, val: string | boolean) => {
    setForm(f => ({ ...f, [key]: val }));
    if (status === 'error') setStatus('idle');
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setStatus('idle');
    setMessage('');
    setProvisioned(null);
    setCopied(false);
  };

  const copySecret = async () => {
    if (!provisioned) return;
    await navigator.clipboard.writeText(provisioned.secretKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setStatus('error');
      setMessage(validationError);
      return;
    }

    let stellarAddress = form.stellar_address;

    // Provision wallet if requested
    if (form.provision_wallet) {
      setStatus('provisioning');
      try {
        const res = await fetch('/api/provision-wallet', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error ?? 'Wallet provisioning failed');
        }
        const wallet: ProvisionedWallet = await res.json();
        setProvisioned(wallet);
        stellarAddress = wallet.publicKey;
      } catch (e: any) {
        setStatus('error');
        setMessage(`Wallet provisioning failed: ${e.message}`);
        return;
      }
    }

    setStatus('loading');
    try {
      const manifest = {
        agent_id: form.agent_id,
        name: form.name,
        description: form.description,
        capabilities: form.capabilities.split(',').map(s => s.trim()).filter(Boolean),
        pricing: {
          model: form.payment_model,
          price_per_call: parseFloat(form.price_per_call),
          currency: 'USDC',
        },
        endpoint: form.endpoint,
        stellar_address: stellarAddress,
        health_check: form.health_check || `${form.endpoint.replace(/\/[^/]*$/, '')}/health`,
        // Track who registered this agent so they can edit/delete it later
        registered_by: publicKey ?? undefined,
      };

      const res = await fetch(`${REGISTRY_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });

      if (res.ok) {
        setStatus('success');
        setMessage(`${form.name} registered successfully! It will appear in the agent list and be available for tasks immediately.`);
      } else {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus('error');
        setMessage(err.error ?? 'Registration failed');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(`Could not reach registry: ${e.message}`);
    }
  };

  const canSubmit = status !== 'loading' && status !== 'provisioning' &&
    form.agent_id.trim() !== '' &&
    form.endpoint.trim() !== '' &&
    (form.provision_wallet || form.stellar_address.trim() !== '');

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <PlusCircle size={18} className="text-purple-400" />
          <h2 className="text-base font-semibold text-gray-200">Register Agent</h2>
        </div>

        {status === 'success' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-green-950 border border-green-800 rounded-lg p-4">
              <Check size={16} className="text-green-400 mt-0.5 shrink-0" />
              <p className="text-sm text-green-300">{message}</p>
            </div>

            {/* Show provisioned wallet details */}
            {provisioned && (
              <div className="bg-yellow-950 border border-yellow-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-300">Wallet provisioned — save your secret key now</span>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Public Key</div>
                  <div className="font-mono text-xs text-gray-300 bg-gray-800 rounded px-2 py-1.5 break-all">
                    {provisioned.publicKey}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Secret Key (save this — shown once)</div>
                  <div className="font-mono text-xs text-red-300 bg-gray-800 rounded px-2 py-1.5 break-all border border-red-900">
                    {provisioned.secretKey}
                  </div>
                  <button
                    onClick={copySecret}
                    className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <Copy size={11} />
                    {copied ? 'Copied!' : 'Copy secret key'}
                  </button>
                </div>
                {provisioned.explorerUrl && (
                  <a
                    href={provisioned.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink size={11} />
                    View sponsorship on stellar.expert
                  </a>
                )}
              </div>
            )}

            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              <RefreshCw size={14} />
              Register Another Agent
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {[
                { key: 'agent_id', label: 'Agent ID', placeholder: 'my-agent (lowercase, hyphens ok)' },
                { key: 'name', label: 'Display Name', placeholder: 'MyBot' },
                { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://my-server.com/query' },
                { key: 'health_check', label: 'Health Check URL (optional)', placeholder: 'auto-derived from endpoint if blank' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key as keyof typeof form] as string}
                    onChange={e => update(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                  />
                </div>
              ))}

              {/* Stellar address or wallet provisioning */}
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="provision_wallet"
                    checked={form.provision_wallet}
                    onChange={e => update('provision_wallet', e.target.checked)}
                    className="accent-purple-500"
                  />
                  <label htmlFor="provision_wallet" className="text-xs text-gray-300 cursor-pointer">
                    Provision a Stellar wallet for me (sponsored — free, USDC-ready)
                  </label>
                </div>
                {!form.provision_wallet && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Stellar Address (G...)</label>
                    <input
                      type="text"
                      value={form.stellar_address}
                      onChange={e => update('stellar_address', e.target.value)}
                      placeholder="G... (56 characters)"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                )}
                {form.provision_wallet && (
                  <p className="text-xs text-gray-500">
                    A new Stellar account will be created and sponsored. The secret key will be shown after registration — save it immediately.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  placeholder="What does your agent do?"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Capabilities (comma-separated)</label>
                <input
                  type="text"
                  value={form.capabilities}
                  onChange={e => update('capabilities', e.target.value)}
                  placeholder="news, translation, data-analysis"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Payment Model</label>
                  <select
                    value={form.payment_model}
                    onChange={e => update('payment_model', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value="x402">x402</option>
                    <option value="mpp">MPP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price per call (USDC)</label>
                  <input
                    type="number"
                    value={form.price_per_call}
                    onChange={e => update('price_per_call', e.target.value)}
                    step={0.001}
                    min={0}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>

            {status === 'error' && (
              <div className="mt-4 flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg p-3">
                <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <span className="text-sm text-red-300">{message}</span>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {(status === 'error' || form.agent_id) && (
                <button
                  onClick={reset}
                  className="px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
              >
                {status === 'provisioning' ? 'Provisioning wallet...' :
                 status === 'loading' ? 'Registering...' :
                 form.provision_wallet ? 'Provision Wallet & Register' : 'Register Agent'}
              </button>
            </div>
          </>
        )}

        <div className="mt-4 pt-4 border-t border-gray-800">
          <p className="text-xs text-gray-600">
            Your agent must implement <code className="text-gray-500">GET /health</code> and at least one x402 or MPP protected endpoint. It will be available for task assignment immediately after registration.
          </p>
        </div>
      </div>
    </div>
  );
}
