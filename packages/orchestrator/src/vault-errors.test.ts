import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import {
  VaultErrorCode,
  VaultContractError,
  extractContractErrorCode,
  errorFromSimulation,
  errorFromSendResponse,
  errorFromFailedTransaction,
} from './vault-errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_LIB_RS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'contracts',
  'agent-vault',
  'src',
  'lib.rs',
);

function diagnosticEventWithContractCode(code: number): xdr.DiagnosticEvent {
  const errorScVal = xdr.ScVal.scvError(xdr.ScError.sceContract(code));
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
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });
}

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
    const code = extractContractErrorCode({
      diagnosticEvents: [diagnosticEventWithContractCode(6)],
    });
    expect(code).toBe(6);
  });

  it('extracts the code from a simulation HostError message', () => {
    const message =
      'HostError: Error(Contract, #9)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...';
    expect(extractContractErrorCode({ message })).toBe(9);
  });

  it('returns null for a diagnostic event that is not a contract error', () => {
    const nonErrorScVal = new Address(Keypair.random().publicKey()).toScVal();
    const body = new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({ topics: [], data: nonErrorScVal }),
    );
    const event = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.contract(),
      body,
    });
    const diag = new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event });
    expect(extractContractErrorCode({ diagnosticEvents: [diag] })).toBeNull();
  });

  it('returns null for a non-contract failure (network/auth error text)', () => {
    expect(
      extractContractErrorCode({ message: 'HostError: Error(Auth, InvalidAction)' }),
    ).toBeNull();
    expect(extractContractErrorCode({ message: 'fetch failed: ECONNREFUSED' })).toBeNull();
    expect(extractContractErrorCode({})).toBeNull();
  });

  it('prefers diagnostic events over the message when both are present', () => {
    const code = extractContractErrorCode({
      message: 'HostError: Error(Contract, #1)',
      diagnosticEvents: [diagnosticEventWithContractCode(2)],
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

  it('preserves and flags an unmapped/unknown code rather than swallowing it', () => {
    const err = new VaultContractError(999, 'raw-value');
    expect(err.code).toBe(999);
    expect(err.codeName).toBeUndefined();
    expect(err.known).toBe(false);
    expect(err.raw).toBe('raw-value');
    expect(err.message).toContain('999');
  });
});

describe('error builders', () => {
  it('errorFromSimulation returns a VaultContractError for a contract revert', () => {
    const sim = { error: 'HostError: Error(Contract, #18)', events: [] } as any;
    const err = errorFromSimulation(sim);
    expect(err).toBeInstanceOf(VaultContractError);
    expect((err as VaultContractError).code).toBe(18);
    expect((err as VaultContractError).codeName).toBe('TooManyActiveTasks');
  });

  it('errorFromSimulation returns a plain Error for a non-contract simulation failure', () => {
    const sim = { error: 'HostError: Error(Auth, InvalidAction)', events: [] } as any;
    const err = errorFromSimulation(sim);
    expect(err).not.toBeInstanceOf(VaultContractError);
    expect(err.message).toContain('Simulation failed');
  });

  it('errorFromSendResponse returns a VaultContractError when diagnostic events carry the code', () => {
    const response = {
      status: 'ERROR',
      diagnosticEvents: [diagnosticEventWithContractCode(9)],
    } as any;
    const err = errorFromSendResponse(response);
    expect(err).toBeInstanceOf(VaultContractError);
    expect((err as VaultContractError).code).toBe(9);
    expect((err as VaultContractError).codeName).toBe('TaskAlreadyCompleted');
  });

  it('errorFromSendResponse returns a plain Error when there is no contract code', () => {
    const response = { status: 'ERROR', errorResult: { foo: 'bar' } } as any;
    const err = errorFromSendResponse(response);
    expect(err).not.toBeInstanceOf(VaultContractError);
    expect(err.message).toContain('Send failed');
  });

  it('errorFromFailedTransaction returns a VaultContractError when diagnostic events carry the code', () => {
    const result = {
      status: 'FAILED',
      diagnosticEventsXdr: [diagnosticEventWithContractCode(24)],
    } as any;
    const err = errorFromFailedTransaction('deadbeef', result);
    expect(err).toBeInstanceOf(VaultContractError);
    expect((err as VaultContractError).code).toBe(24);
    expect((err as VaultContractError).codeName).toBe('ReleaseConflict');
  });

  it('errorFromFailedTransaction returns a plain Error when no contract code is present', () => {
    const result = { status: 'FAILED' } as any;
    const err = errorFromFailedTransaction('deadbeef', result);
    expect(err).not.toBeInstanceOf(VaultContractError);
    expect(err.message).toContain('deadbeef');
  });
});
