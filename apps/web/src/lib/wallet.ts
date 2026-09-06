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

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new RabetModule(),
  ],
});

/** Open the wallet picker and return the connected address. */
export function connectWallet(): Promise<{ address: string }> {
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
  const { signedTxXdr } = await kit.signTransaction(xdr, { networkPassphrase });
  if (!signedTxXdr) throw new Error('Wallet returned no signed transaction');
  return signedTxXdr;
}
