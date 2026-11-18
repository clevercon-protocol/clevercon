import type { ISupportedWallet, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { IS_MAINNET } from './network';

// The wallet kit (and its Stellar deps) is large and only needed once a user
// actually connects or signs, so it is loaded lazily in its own chunk rather
// than shipped in the main bundle. The instance is memoised after first use.
let kitPromise: Promise<StellarWalletsKit> | null = null;

// Which wallet the user picked (freighter, xbull, ...). Persisted so that after a
// page refresh, when the session is restored but the kit is a fresh instance, we
// can re-select the wallet before signing (otherwise the kit throws
// "Please set the wallet first").
const WALLET_ID_KEY = 'clevercon.walletId';

function getKit(): Promise<StellarWalletsKit> {
  if (!kitPromise) {
    kitPromise = import('@creit.tech/stellar-wallets-kit').then((m) => {
      return new m.StellarWalletsKit({
        network: IS_MAINNET ? m.WalletNetwork.PUBLIC : m.WalletNetwork.TESTNET,
        modules: [
          new m.FreighterModule(),
          new m.xBullModule(),
          new m.AlbedoModule(),
          new m.LobstrModule(),
          new m.RabetModule(),
        ],
      });
    });
  }
  return kitPromise;
}

/**
 * Warm the wallet-kit chunk (a ~280KB gzip lazy chunk) ahead of the first connect,
 * e.g. while the landing page sits idle, so clicking "Connect wallet" does not pay
 * a cold download. Safe to call repeatedly: the kit promise is memoised and errors
 * are swallowed (it is only a prefetch).
 */
export function preloadWallet(): void {
  void getKit().catch(() => {});
}

/** Ensure the kit has a wallet selected (re-applying the persisted choice). */
function ensureWallet(kit: StellarWalletsKit): void {
  const id = typeof localStorage !== 'undefined' ? localStorage.getItem(WALLET_ID_KEY) : null;
  if (id) kit.setWallet(id);
}

/** Forget the selected wallet (call on disconnect). */
export function clearSelectedWallet(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(WALLET_ID_KEY);
}

/** Open the wallet picker and return the connected address. */
export async function connectWallet(): Promise<{ address: string }> {
  const kit = await getKit();
  return new Promise((resolve, reject) => {
    kit
      .openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          try {
            kit.setWallet(option.id);
            if (typeof localStorage !== 'undefined') localStorage.setItem(WALLET_ID_KEY, option.id);
            const { address } = await kit.getAddress();
            if (!address) throw new Error('Wallet returned no address');
            resolve({ address });
          } catch (e) {
            reject(e as Error);
          }
        },
      })
      .catch(reject);
  });
}

/** Sign a transaction XDR with the connected wallet. */
export async function signTransaction(xdr: string, networkPassphrase: string): Promise<string> {
  const kit = await getKit();
  // The kit instance does not survive a page refresh; re-select the persisted
  // wallet so signing works even when only the session was restored.
  ensureWallet(kit);
  try {
    const { signedTxXdr } = await kit.signTransaction(xdr, { networkPassphrase });
    if (!signedTxXdr) throw new Error('Wallet returned no signed transaction');
    return signedTxXdr;
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    // The common cause here is the wallet being locked, disconnected, or switched
    // to a different account than this session. Make that actionable.
    if (/not connected|no wallet|getAddress|account|rejected|user declined/i.test(msg)) {
      throw new Error(
        'Wallet not available (it may be locked or on a different account than this session). Reconnect your wallet and try again.',
      );
    }
    throw e as Error;
  }
}

/** The wallet's current active address, or null if it can't be read (locked /
 * disconnected). Used to detect that the browser wallet switched accounts. */
export async function getConnectedAddress(): Promise<string | null> {
  try {
    const kit = await getKit();
    ensureWallet(kit);
    const { address } = await kit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}
