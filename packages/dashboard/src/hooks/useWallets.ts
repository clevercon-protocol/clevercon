import { useEffect, useState } from 'react';

const HORIZON = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export interface WalletBalance {
  address: string;
  label: string;
  xlm: string;
  usdc: string | null; // null = no trust line, omit from display
  loading: boolean;
  error: boolean;
}

async function fetchBalance(address: string, label: string): Promise<WalletBalance> {
  try {
    const res = await fetch(`${HORIZON}/accounts/${address}`);
    if (res.status === 404) {
      return { address, label, xlm: '0.00', usdc: null, loading: false, error: false };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const balances: any[] = data.balances ?? [];

    const xlmEntry = balances.find((b: any) => b.asset_type === 'native');
    const usdcEntry = balances.find(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
    );

    const xlm = xlmEntry ? parseFloat(xlmEntry.balance).toFixed(2) : '0.00';
    // Only expose USDC if a trust line exists (even if balance is 0)
    const usdc = usdcEntry ? parseFloat(usdcEntry.balance).toFixed(4) : null;

    return { address, label, xlm, usdc, loading: false, error: false };
  } catch {
    return { address, label, xlm: '—', usdc: null, loading: false, error: true };
  }
}

export function useWallets(wallets: Array<{ address: string; label: string }>) {
  const [balances, setBalances] = useState<WalletBalance[]>(() =>
    wallets.map(w => ({ ...w, xlm: '…', usdc: null, loading: true, error: false }))
  );

  const key = wallets.map(w => w.address).join(',');

  useEffect(() => {
    if (wallets.length === 0) {
      setBalances([]);
      return;
    }

    // Show loading placeholders immediately when wallet list changes
    setBalances(wallets.map(w => ({ ...w, xlm: '…', usdc: null, loading: true, error: false })));

    let cancelled = false;

    const fetchAll = async () => {
      const results = await Promise.all(wallets.map(w => fetchBalance(w.address, w.label)));
      if (!cancelled) setBalances(results);
    };

    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return balances;
}
