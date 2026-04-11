/**
 * WalletProvider — multi-wallet context via @creit.tech/stellar-wallets-kit.
 *
 * Supports: Freighter, xBull, Albedo, LOBSTR, Rabet.
 * WalletConnect is intentionally excluded to avoid MetaMask/WC noise.
 * The kit's built-in modal is NOT used — ConnectWallet renders its own UI
 * so we can avoid the kit's platform-detection quirks.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
  RabetModule,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';

export type { ISupportedWallet };

interface WalletContextValue {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  walletId: string | null;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
  getSupportedWallets: () => Promise<ISupportedWallet[]>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const LS_PUBKEY    = 'clevercon_pubkey';
const LS_WALLET_ID = 'clevercon_wallet_id';

const NETWORK = WalletNetwork.TESTNET;

function buildKit(selectedWalletId?: string): StellarWalletsKit {
  return new StellarWalletsKit({
    network: NETWORK,
    selectedWalletId,
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new LobstrModule(),
      new RabetModule(),
    ],
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [walletId,  setWalletId]  = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Keep a stable kit ref; recreated when walletId changes.
  const kitRef = useRef<StellarWalletsKit>(buildKit());

  useEffect(() => {
    // Restore session from localStorage
    const storedKey      = localStorage.getItem(LS_PUBKEY);
    const storedWalletId = localStorage.getItem(LS_WALLET_ID);
    if (storedKey && storedWalletId) {
      kitRef.current = buildKit(storedWalletId);
      setPublicKey(storedKey);
      setWalletId(storedWalletId);
    }
    setIsLoading(false);
  }, []);

  const connect = async (id: string) => {
    setIsLoading(true);
    try {
      kitRef.current = buildKit(id);
      kitRef.current.setWallet(id);
      const { address } = await kitRef.current.getAddress();
      if (!address) throw new Error('Could not retrieve public key from wallet.');
      setPublicKey(address);
      setWalletId(id);
      localStorage.setItem(LS_PUBKEY,    address);
      localStorage.setItem(LS_WALLET_ID, id);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = () => {
    kitRef.current.disconnect?.().catch(() => {});
    setPublicKey(null);
    setWalletId(null);
    localStorage.removeItem(LS_PUBKEY);
    localStorage.removeItem(LS_WALLET_ID);
  };

  const signTransaction = async (xdr: string, networkPassphrase: string): Promise<string> => {
    const { signedTxXdr } = await kitRef.current.signTransaction(xdr, { networkPassphrase });
    if (!signedTxXdr) throw new Error('Wallet returned no signed XDR.');
    return signedTxXdr;
  };

  const getSupportedWallets = (): Promise<ISupportedWallet[]> =>
    kitRef.current.getSupportedWallets();

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnected: !!publicKey,
        isLoading,
        walletId,
        connect,
        disconnect,
        signTransaction,
        getSupportedWallets,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
