import { describe, it, expect } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import { decodeSorobanEvent, jsonSafe } from './events';

describe('jsonSafe', () => {
  it('converts bigint to string, recursively', () => {
    expect(jsonSafe(10n)).toBe('10');
    expect(jsonSafe({ a: 1n, b: [2n, { c: 3n }] })).toEqual({ a: '1', b: ['2', { c: '3' }] });
    expect(jsonSafe('x')).toBe('x');
  });
});

describe('decodeSorobanEvent', () => {
  it('decodes the topic symbol as the event type and passes through metadata', () => {
    const raw = {
      contractId: 'CVAULT',
      topic: [xdr.ScVal.scvSymbol('deposit')],
      value: xdr.ScVal.scvString('hello'),
      ledger: 12345,
      id: 'cursor-1',
      txHash: 'txabc',
    };
    const e = decodeSorobanEvent(raw);
    expect(e.type).toBe('deposit');
    expect(e.contractId).toBe('CVAULT');
    expect(e.ledger).toBe(12345n);
    expect(e.txHash).toBe('txabc');
    expect(e.cursor).toBe('cursor-1');
    expect(e.payload).toEqual({ topics: [], data: 'hello' });
  });

  it('handles missing fields without throwing', () => {
    const e = decodeSorobanEvent({});
    expect(e.type).toBe('unknown');
    expect(e.ledger).toBe(0n);
    expect(e.cursor).toBe('');
  });
});
