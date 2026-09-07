import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { VaultContractService } from './vault-contract.service.js';

type Cfg = Record<string, string | undefined>;
function make(cfg: Cfg): VaultContractService {
  return new VaultContractService({ get: (k: string) => cfg[k] } as never);
}

describe('VaultContractService (inactive gate)', () => {
  it('is inactive when the contract id is unset or a placeholder', () => {
    expect(make({}).active).toBe(false);
    expect(make({ AGENT_VAULT_CONTRACT_ID: 'C...' }).active).toBe(false);
    expect(make({ AGENT_VAULT_CONTRACT_ID: 'short' }).active).toBe(false);
  });

  it('is active for a real-looking contract id', () => {
    const svc = make({ AGENT_VAULT_CONTRACT_ID: 'CDLZ' + 'A'.repeat(52) });
    expect(svc.active).toBe(true);
  });

  it('raises ServiceUnavailable on mutating calls when inactive', async () => {
    const svc = make({});
    await expect(svc.buildDepositXdr('GABC', 10)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(svc.buildWithdrawXdr('GABC', 10)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(svc.submitSignedXdr('xdr')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
