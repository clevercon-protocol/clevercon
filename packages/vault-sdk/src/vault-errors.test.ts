import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import {
  VaultErrorCode,
  VaultContractError,
  extractContractErrorCode,
} from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_LIB_RS = path.join(
  __dirname,
  '..', '..', '..', 'contracts', 'agent-vault', 'src', 'lib.rs',
);

describe('VaultErrorCode mirrors the Rust VaultError enum', () => {
  it('matches every variant and discriminant in contracts/agent-vault/src/lib.rs exactly', () => {
    const rustSrc = readFileSync(CONTRACT_LIB_RS, 'utf-8');
    const enumMatch = rustSrc.match(/pub enum VaultError\s*\{([\s\S]*?)\n\}/);
    expect(enumMatch, 'could not find `pub enum VaultError { ... }` in lib.rs').not.toBeNull();

    const body = enumMatch![1];
    const variantPattern = /(\w+)\s*=\s*(\d+),/g;
    const rustVariants: Record<string, number> = {};
    let match: RegExpExecArray | null;
    while ((match = variantPattern.exec(body)) !== null) {
      rustVariants[match[1]] = Number(match[2]);
    }
    expect(Object.keys(rustVariants).length).toBeGreaterThan(0);

    const tsVariants: Record<string, number> = {};
    for (const key of Object.keys(VaultErrorCode)) {
      const value = VaultErrorCode[key as keyof typeof VaultErrorCode];
      if (typeof value === 'number') {
        tsVariants[key] = value;
      }
    }

    expect(tsVariants).toEqual(rustVariants);
  });
});

describe('extractContractErrorCode', () => {
  it('extracts the code from a diagnostic event carrying a scvError(sceContract)', () => {
    const errorScVal = xdr.ScVal.scvError(xdr.ScError.sceContract(6));
    const body = new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({ topics: [], data: errorScVal }),
    );
    const event = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body,
    });
    const diag = new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });

    const code = extractContractErrorCode({ diagnosticEvents: [diag] });
    expect(code).toBe(6);
  });

  it('extracts the code from a simulation HostError message', () => {
    const message = 'HostError: Error(Contract, #9)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...';
    expect(extractContractErrorCode({ message })).toBe(9);
  });

  it('returns null for a non-contract failure', () => {
    expect(extractContractErrorCode({ message: 'fetch failed: ECONNREFUSED' })).toBeNull();
    expect(extractContractErrorCode({})).toBeNull();
  });

  it('prefers diagnostic events over the message when both are present', () => {
    const errorScVal = xdr.ScVal.scvError(xdr.ScError.sceContract(2));
    const body = new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({ topics: [], data: errorScVal }),
    );
    const event = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body,
    });
    const diag = new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });

    const code = extractContractErrorCode({
      message: 'HostError: Error(Contract, #1)',
      diagnosticEvents: [diag],
    });
    expect(code).toBe(2);
  });
});

describe('VaultContractError', () => {
  it('marks a known code with its variant name', () => {
    const err = new VaultContractError(6, { some: 'raw' });
    expect(err.code).toBe(6);
    expect(err.codeName).toBe('InsufficientAvailable');
    expect(err.known).toBe(true);
    expect(err.raw).toEqual({ some: 'raw' });
    expect(err.message).toContain('InsufficientAvailable');
  });

  it('preserves and flags an unmapped/unknown code', () => {
    const err = new VaultContractError(999, 'raw-value');
    expect(err.code).toBe(999);
    expect(err.codeName).toBeUndefined();
    expect(err.known).toBe(false);
    expect(err.raw).toBe('raw-value');
    expect(err.message).toContain('999');
  });
});
