import { Horizon, Asset } from '@stellar/stellar-sdk';
import { CACHE_TTLS, getCached } from './cache.js';

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_CODE = 'USDC';

export async function getXLMUSDCTrades(limit: number = 20) {
  return getCached(`price:trades:${limit}`, CACHE_TTLS.priceMs, async () => {
    const trades = await server
      .trades()
      .forAssetPair(Asset.native(), new Asset(USDC_CODE, USDC_ISSUER))
      .limit(limit)
      .order('desc')
      .call();

    return trades.records.map((t) => ({
      price: t.price?.n && t.price?.d ? (Number(t.price.n) / Number(t.price.d)).toFixed(6) : 'N/A',
      base_amount: t.base_amount,
      counter_amount: t.counter_amount,
      timestamp: t.ledger_close_time,
    }));
  });
}

export async function getOrderbook() {
  return getCached('price:orderbook', CACHE_TTLS.priceMs, async () => {
    const orderbook = await server
      .orderbook(Asset.native(), new Asset(USDC_CODE, USDC_ISSUER))
      .call();

    return {
      bids: orderbook.bids.slice(0, 5).map((b) => ({ price: b.price, amount: b.amount })),
      asks: orderbook.asks.slice(0, 5).map((a) => ({ price: a.price, amount: a.amount })),
      spread:
        orderbook.asks[0] && orderbook.bids[0]
          ? (parseFloat(orderbook.asks[0].price) - parseFloat(orderbook.bids[0].price)).toFixed(6)
          : 'N/A',
    };
  });
}

export async function getAssetMetadata() {
  return getCached('asset:usdc-metadata', CACHE_TTLS.assetMs, async () => {
    const assets = await server.assets().forCode(USDC_CODE).forIssuer(USDC_ISSUER).limit(1).call();
    const record = assets.records[0];

    return {
      code: USDC_CODE,
      issuer: USDC_ISSUER,
      accounts: record?.num_accounts ?? 0,
      amount: record?.amount ?? '0',
    };
  });
}

export async function getAccountBalances(address: string) {
  return getCached(`account:${address}`, CACHE_TTLS.accountMs, async () => {
    try {
      const account = await server.loadAccount(address);
      return account.balances.map((b: any) => ({
        asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}`,
        balance: b.balance,
      }));
    } catch {
      return [{ asset: 'error', balance: 'Account not found' }];
    }
  });
}

export async function getNetworkStats() {
  const ledger = await server.ledgers().limit(1).order('desc').call();
  const latest = ledger.records[0];
  return {
    latest_ledger: latest.sequence,
    total_operations: latest.operation_count,
    base_fee: latest.base_fee_in_stroops,
    closed_at: latest.closed_at,
  };
}
