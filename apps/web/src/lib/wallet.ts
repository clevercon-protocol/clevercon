import type { ISupportedWallet, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';

// The wallet kit (and its Stellar deps) is large and only needed once a user
// actually connects or signs, so it is loaded lazily in its own chunk rather
// than shipped in the main bundle. The instance is memoised after first use.
let kitPromise: Promise<StellarWalletsKit> | null = null;

function getKit(): Promise<StellarWalletsKit> {
  if (!kitPromise) {
    kitPromise = import('@creit.tech/stellar-wallets-kit').then((m) => {
      return new m.StellarWalletsKit({
        network: m.WalletNetwork.TESTNET,
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

/** Open the wallet picker and return the connected address. */
export async function connectWallet(): Promise<{ address: string }> {
  const kit = await getKit();
  return new Promise((resolve, reject) => {
    kit
      .openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          try {
            kit.setWallet(option.id);
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
  const { signedTxXdr } = await kit.signTransaction(xdr, { networkPassphrase });
  if (!signedTxXdr) throw new Error('Wallet returned no signed transaction');
  return signedTxXdr;
}
