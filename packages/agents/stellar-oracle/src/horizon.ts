import { Horizon, Asset } from '@stellar/stellar-sdk';

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export async function getXLMUSDCTrades(limit: number = 20) {
  const trades = await server.trades()
    .forAssetPair(Asset.native(), new Asset('USDC', USDC_ISSUER))
    .limit(limit)
    .order('desc')
    .call();

  return trades.records.map(t => ({
    price: t.price?.n && t.price?.d
      ? (Number(t.price.n) / Number(t.price.d)).toFixed(6)
      : 'N/A',
    base_amount: t.base_amount,
    counter_amount: t.counter_amount,
    timestamp: t.ledger_close_time,
  }));
}

export async function getOrderbook() {
  const orderbook = await server.orderbook(
    Asset.native(),
    new Asset('USDC', USDC_ISSUER)
  ).call();

  return {
    bids: orderbook.bids.slice(0, 5).map(b => ({ price: b.price, amount: b.amount })),
    asks: orderbook.asks.slice(0, 5).map(a => ({ price: a.price, amount: a.amount })),
    spread: orderbook.asks[0] && orderbook.bids[0]
      ? (parseFloat(orderbook.asks[0].price) - parseFloat(orderbook.bids[0].price)).toFixed(6)
      : 'N/A',
  };
}

export async function getAccountBalances(address: string) {
  try {
    const account = await server.loadAccount(address);
    return account.balances.map((b: any) => ({
      asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}`,
      balance: b.balance,
    }));
  } catch {
    return [{ asset: 'error', balance: 'Account not found' }];
  }
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
