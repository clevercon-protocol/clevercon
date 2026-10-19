/**
 * Can a payout address actually receive USDC? A Stellar account can only hold a
 * SAC/classic asset it has a trustline for, so a provider whose payout wallet has
 * no USDC trustline is silently unpayable: a release reverts and the hire refunds.
 * We check Horizon for the classic USDC trustline and surface readiness at
 * registration and in the provider's service list. Best-effort: a check that
 * can't run returns null (unknown), so we never block on a transient Horizon blip.
 */

const DEFAULT_HORIZON = 'https://horizon-testnet.stellar.org';
// Circle testnet USDC issuer (its SAC is the testnet USDC_SAC). Override per env.
const DEFAULT_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export function usdcIssuer(): string {
  return process.env.USDC_ISSUER || DEFAULT_USDC_ISSUER;
}
function horizonUrl(): string {
  return (process.env.HORIZON_URL || DEFAULT_HORIZON).replace(/\/+$/, '');
}

interface HorizonBalance {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * True if `address` holds a USDC trustline to the configured issuer, false if the
 * account exists but has no such trustline (or is unfunded), null if the check
 * could not run (network/parse error).
 */
export async function hasUsdcTrustline(address: string): Promise<boolean | null> {
  if (!/^G[A-Z2-7]{55}$/.test(address)) return false;
  const issuer = usdcIssuer();
  try {
    const res = await fetch(`${horizonUrl()}/accounts/${address}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return false; // not funded -> cannot receive anything
    if (!res.ok) return null;
    const acct = (await res.json()) as { balances?: HorizonBalance[] };
    return (acct.balances ?? []).some(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === issuer,
    );
  } catch {
    return null;
  }
}
