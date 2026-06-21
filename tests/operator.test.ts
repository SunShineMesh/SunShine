import { describe, it, expect } from 'vitest';
import {
  OPERATOR_CRED_TYPE,
  encodeOperatorURI,
  decodeOperatorURI,
  embedOperatorRef,
  extractOperatorRef,
  type OperatorTerms,
} from '../src/xrpl/operator.js';
import { toHex } from '../src/xrpl/codec.js';

// ── OPERATOR_CRED_TYPE hex ────────────────────────────────────────────────────

describe('OPERATOR_CRED_TYPE', () => {
  it('is hex of "operator_v1" in UPPERCASE', () => {
    expect(OPERATOR_CRED_TYPE).toBe(toHex('operator_v1'));
    expect(OPERATOR_CRED_TYPE).toBe(Buffer.from('operator_v1').toString('hex').toUpperCase());
  });

  it('exact expected hex value', () => {
    // "operator_v1" → 6F70657261746F725F7631
    expect(OPERATOR_CRED_TYPE).toBe('6F70657261746F725F7631');
  });
});

// ── encodeOperatorURI / decodeOperatorURI round-trip ─────────────────────────

describe('encodeOperatorURI / decodeOperatorURI', () => {
  const terms: OperatorTerms = {
    v: 1,
    btier: 'BTIER-2',
    maxDelegatedSpend: '10000',
    kybHash: 'ABCDEF1234567890',
    juris: 'CH',
    exp: 900000000,
  };

  it('encodes to uppercase hex and decodes back to the same object', () => {
    const hex = encodeOperatorURI(terms);
    expect(hex).toMatch(/^[0-9A-F]+$/);
    expect(decodeOperatorURI(hex)).toEqual(terms);
  });

  it('encoded payload uses compact keys (v, btier, maxDelegatedSpend, kybHash, juris, exp)', () => {
    const hex = encodeOperatorURI(terms);
    const json = Buffer.from(hex, 'hex').toString('utf8');
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed)).toEqual(['v', 'btier', 'maxDelegatedSpend', 'kybHash', 'juris', 'exp']);
  });

  it('encoded byte length stays within 256-byte XLS-70 URI cap', () => {
    const hex = encodeOperatorURI(terms);
    const byteLen = Buffer.byteLength(Buffer.from(hex, 'hex').toString('utf8'), 'utf8');
    expect(byteLen).toBeLessThanOrEqual(256);
  });

  it('throws when URI payload would exceed 256 bytes', () => {
    const big: OperatorTerms = { ...terms, kybHash: 'A'.repeat(300) };
    expect(() => encodeOperatorURI(big)).toThrow(/256/);
  });

  it('round-trip survives BTIER-4 and large maxDelegatedSpend', () => {
    const big: OperatorTerms = { v: 1, btier: 'BTIER-4', maxDelegatedSpend: '50000', kybHash: 'DEADBEEF12345678', juris: 'SG', exp: 999999999 };
    expect(decodeOperatorURI(encodeOperatorURI(big))).toEqual(big);
  });

  it('decodes a legacy v1 URI that used the old aggLimit key', () => {
    const legacyHex = Buffer.from(JSON.stringify({ v: 1, btier: 'BTIER-2', aggLimit: '2500', kybHash: 'AB', juris: 'CH', exp: 900000000 }), 'utf8').toString('hex').toUpperCase();
    const t = decodeOperatorURI(legacyHex);
    expect(t.maxDelegatedSpend).toBe('2500');
  });
});

// ── embedOperatorRef / extractOperatorRef ────────────────────────────────────

describe('embedOperatorRef / extractOperatorRef', () => {
  const baseTerms = {
    v: 1 as const,
    tier: 'TIER-2',
    maxTxAmount: '100',
    score: 65,
    exp: 900000000,
    ref: '23C9FE5AA800785C',
  };

  it('extracts undefined when no op field is present', () => {
    expect(extractOperatorRef(baseTerms)).toBeUndefined();
  });

  it('embeds an operator address and extracts it back', () => {
    const addr = 'rOperatorXXXXXXXXXXXXXXXXXXXXXXXX';
    const extended = embedOperatorRef(baseTerms, { op: addr });
    expect(extractOperatorRef(extended)).toBe(addr);
  });

  it('embeds an operator credentialId and extracts it back', () => {
    const credId = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
    const extended = embedOperatorRef(baseTerms, { op: credId });
    expect(extractOperatorRef(extended)).toBe(credId);
  });

  it('does not mutate the original terms object', () => {
    const addr = 'rOperatorXXXXXXXXXXXXXXXXXXXXXXXX';
    const original = { ...baseTerms };
    embedOperatorRef(baseTerms, { op: addr });
    expect(baseTerms).toEqual(original);
  });

  it('preserves all original TrustTerms fields after embedding', () => {
    const addr = 'rOperatorYYYYYYYYYYYYYYYYYYYYYYYYYY';
    const extended = embedOperatorRef(baseTerms, { op: addr });
    expect(extended.v).toBe(baseTerms.v);
    expect(extended.tier).toBe(baseTerms.tier);
    expect(extended.maxTxAmount).toBe(baseTerms.maxTxAmount);
    expect(extended.score).toBe(baseTerms.score);
    expect(extended.exp).toBe(baseTerms.exp);
    expect(extended.ref).toBe(baseTerms.ref);
  });
});
