import { useState, useEffect, useCallback } from 'react';
import { Vault, ExternalLink, Plus, Minus, X, RefreshCw, Lock, CheckCircle } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { fetchVaultAccount, buildDepositXdr, buildWithdrawXdr, submitVaultXdr, type VaultAccount } from '../lib/vault-client';

const VAULT_CONTRACT_ID = 'CDFLEJ2HFPK3WKFTWB4CKP2JHEYNAUWKXGEJRYW4YMMGDSQSQ7D4LRTE';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const QUICK_AMOUNTS = [1, 5, 10, 20];

type Modal = 'none' | 'fund' | 'withdraw';

interface ModalState {
  amount: string;
  status: 'idle' | 'building' | 'signing' | 'submitting' | 'success' | 'error';
  error: string | null;
  txHash: string | null;
}

const INITIAL_MODAL: ModalState = { amount: '', status: 'idle', error: null, txHash: null };

interface VaultPanelProps {
  forceOpenFund?: boolean;
  onFundOpened?: () => void;
  onDepositSuccess?: () => void;
  onWithdrawSuccess?: () => void;
  onError?: (message: string) => void;
}

function normalizeFreighterError(err: any): string {
  const msg: string = err?.message ?? String(err);
  if (/user declined|rejected|denied|cancel/i.test(msg)) {
    return 'Transaction rejected. Try again when ready.';
  }
  if (/simulation failed/i.test(msg)) {
    return 'Simulation failed — check your vault balance and try again.';
  }
  return msg.slice(0, 120);
}

export function VaultPanel({
  forceOpenFund,
  onFundOpened,
  onDepositSuccess,
  onWithdrawSuccess,
  onError,
}: VaultPanelProps = {}) {
  const { publicKey, signTransaction } = useWallet();
  const [account, setAccount] = useState<VaultAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>('none');
  const [modalState, setModalState] = useState<ModalState>(INITIAL_MODAL);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      const data = await fetchVaultAccount(publicKey);
      setAccount(data);    // Only update state on a successful response
    } catch {
      // RPC transient error — keep last known balance, don't flash zero
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Allow parent to open fund modal programmatically (e.g. from insufficient balance modal)
  useEffect(() => {
    if (forceOpenFund && modal === 'none') {
      setModal('fund');
      setModalState(INITIAL_MODAL);
      onFundOpened?.();
    }
  }, [forceOpenFund]);

  const openModal = (type: Modal) => {
    setModal(type);
    setModalState(INITIAL_MODAL);
  };

  const closeModal = () => {
    if (modalState.status === 'signing' || modalState.status === 'submitting') return;
    setModal('none');
    setModalState(INITIAL_MODAL);
    if (modalState.status === 'success') refresh();
  };

  const handleDeposit = async () => {
    if (!publicKey) return;
    const amount = parseFloat(modalState.amount);
    if (!amount || amount <= 0) return;

    try {
      setModalState(s => ({ ...s, status: 'building', error: null }));
      const xdr = await buildDepositXdr(publicKey, amount);

      setModalState(s => ({ ...s, status: 'signing' }));
      const signed = await signTransaction(xdr, NETWORK_PASSPHRASE);

      setModalState(s => ({ ...s, status: 'submitting' }));
      const txHash = await submitVaultXdr(signed, { user_address: publicKey, tx_type: 'deposit', amount });

      setModalState(s => ({ ...s, status: 'success', txHash }));
      refresh();
      onDepositSuccess?.();
    } catch (err: any) {
      const friendlyMsg = normalizeFreighterError(err);
      setModalState(s => ({ ...s, status: 'error', error: friendlyMsg }));
      onError?.(friendlyMsg);
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey) return;
    const amount = parseFloat(modalState.amount);
    if (!amount || amount <= 0) return;
    const maxAvailable = account?.available ?? 0;
    if (amount > maxAvailable) return;

    try {
      setModalState(s => ({ ...s, status: 'building', error: null }));
      const xdr = await buildWithdrawXdr(publicKey, amount);

      setModalState(s => ({ ...s, status: 'signing' }));
      const signed = await signTransaction(xdr, NETWORK_PASSPHRASE);

      setModalState(s => ({ ...s, status: 'submitting' }));
      const txHash = await submitVaultXdr(signed, { user_address: publicKey, tx_type: 'withdrawal', amount });

      setModalState(s => ({ ...s, status: 'success', txHash }));
      refresh();
      onWithdrawSuccess?.();
    } catch (err: any) {
      const friendlyMsg = normalizeFreighterError(err);
      setModalState(s => ({ ...s, status: 'error', error: friendlyMsg }));
      onError?.(friendlyMsg);
    }
  };

  const isBusy = modalState.status === 'building' || modalState.status === 'signing' || modalState.status === 'submitting';
  const isWithdrawDisabled = !account || account.available <= 0 || account.active_tasks_count > 0;

  if (!publicKey) return null;

  return (
    <>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Vault size={16} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-gray-200">CleverVault</h2>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${VAULT_CONTRACT_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-gray-600 hover:text-gray-400 transition-colors"
            title="View contract on Stellar Expert"
          >
            <ExternalLink size={12} />
          </a>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-600 py-3 justify-center">
            <RefreshCw size={11} className="animate-spin" />
            <span>Loading vault…</span>
          </div>
        ) : (
          <>
            {/* Balance display */}
            <div className="bg-gray-800 rounded-xl p-4 mb-3">
              <p className="text-xs text-gray-500 mb-1">Total Balance</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-mono font-bold text-white">
                  {account ? account.balance.toFixed(2) : '0.00'}
                </span>
                <span className="text-sm text-gray-400">USDC</span>
              </div>

              {account && account.locked > 0 && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-400">
                  <Lock size={10} />
                  <span>{account.locked.toFixed(4)} USDC locked in active task</span>
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
                <div className="text-xs">
                  <p className="text-gray-500">Available</p>
                  <p className="text-green-400 font-mono font-semibold">
                    ${account ? account.available.toFixed(2) : '0.00'}
                  </p>
                </div>
                {account && (account.total_deposited > 0 || account.total_spent > 0) && (
                  <div className="text-right text-xs">
                    <p className="text-gray-500">Lifetime spent</p>
                    <p className="text-gray-400 font-mono">${account.total_spent.toFixed(4)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => openModal('fund')}
                className="flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg px-3 py-2 transition-colors"
              >
                <Plus size={12} />
                Fund
              </button>
              <button
                onClick={() => openModal('withdraw')}
                disabled={isWithdrawDisabled}
                title={
                  account?.active_tasks_count
                    ? 'Cannot withdraw while a task is running'
                    : account?.available === 0
                    ? 'No available balance'
                    : undefined
                }
                className="flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 text-xs font-medium rounded-lg px-3 py-2 transition-colors"
              >
                <Minus size={12} />
                Withdraw
              </button>
            </div>

            {account?.active_tasks_count ? (
              <p className="text-xs text-amber-400 text-center mt-2">
                Withdrawal locked — task in progress
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Fund Modal */}
      {modal === 'fund' && (
        <VaultModal
          title="Fund CleverVault"
          subtitle="Deposit USDC from your Freighter wallet into the smart contract"
          amountLabel="Deposit amount (USDC)"
          confirmLabel={isBusy ? statusLabel(modalState.status) : 'Deposit'}
          amount={modalState.amount}
          maxAmount={undefined}
          status={modalState.status}
          error={modalState.error}
          txHash={modalState.txHash}
          onAmountChange={v => setModalState(s => ({ ...s, amount: v, error: null }))}
          onConfirm={handleDeposit}
          onClose={closeModal}
        />
      )}

      {/* Withdraw Modal */}
      {modal === 'withdraw' && (
        <VaultModal
          title="Withdraw from CleverVault"
          subtitle={`Available: $${account?.available.toFixed(2) ?? '0.00'} USDC`}
          amountLabel="Withdraw amount (USDC)"
          confirmLabel={isBusy ? statusLabel(modalState.status) : 'Withdraw'}
          amount={modalState.amount}
          maxAmount={account?.available}
          status={modalState.status}
          error={modalState.error}
          txHash={modalState.txHash}
          onAmountChange={v => setModalState(s => ({ ...s, amount: v, error: null }))}
          onConfirm={handleWithdraw}
          onClose={closeModal}
        />
      )}
    </>
  );
}

// ── Shared modal component ─────────────────────────────────────────────────────

function statusLabel(status: ModalState['status']): string {
  if (status === 'building') return 'Building transaction…';
  if (status === 'signing') return 'Sign in Freighter…';
  if (status === 'submitting') return 'Submitting…';
  return '';
}

interface VaultModalProps {
  title: string;
  subtitle: string;
  amountLabel: string;
  confirmLabel: string;
  amount: string;
  maxAmount?: number;
  status: ModalState['status'];
  error: string | null;
  txHash: string | null;
  onAmountChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function VaultModal({
  title, subtitle, amountLabel, confirmLabel, amount, maxAmount, status,
  error, txHash, onAmountChange, onConfirm, onClose,
}: VaultModalProps) {
  const isBusy = status === 'building' || status === 'signing' || status === 'submitting';
  const isSuccess = status === 'success';
  const parsedAmount = parseFloat(amount);
  const isAmountValid = !isNaN(parsedAmount) && parsedAmount > 0
    && (maxAmount === undefined || parsedAmount <= maxAmount);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          {!isBusy && (
            <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-5 pb-5 space-y-4">
          {isSuccess ? (
            // Success state
            <div className="text-center py-4 space-y-3">
              <div className="w-12 h-12 bg-green-900/40 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={24} className="text-green-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Transaction complete</p>
                {txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 justify-center mt-1"
                  >
                    View on Stellar Expert <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Quick amounts */}
              <div>
                <p className="text-xs text-gray-500 mb-2">{amountLabel}</p>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {QUICK_AMOUNTS.map(q => (
                    <button
                      key={q}
                      onClick={() => onAmountChange(String(q))}
                      disabled={maxAmount !== undefined && q > maxAmount}
                      className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-300 rounded-lg py-1.5 transition-colors border border-gray-700 hover:border-gray-600"
                    >
                      ${q}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={maxAmount}
                    value={amount}
                    onChange={e => onAmountChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl pl-7 pr-14 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
                </div>
                {maxAmount !== undefined && parsedAmount > maxAmount && (
                  <p className="text-xs text-red-400 mt-1">Exceeds available balance (${maxAmount.toFixed(2)})</p>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-900/30 border border-red-800/50 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Status indicator */}
              {isBusy && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <RefreshCw size={11} className="animate-spin" />
                  <span>{confirmLabel}</span>
                </div>
              )}

              {/* Confirm button */}
              <button
                onClick={onConfirm}
                disabled={isBusy || !isAmountValid}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors"
              >
                {isBusy ? '…' : confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
