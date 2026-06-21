import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  toHex, fromHex, toRippleEpoch, invoiceId, dossierRef,
  encodeTrustURI, decodeTrustURI, CRED_TYPE, LSF_ACCEPTED,
  makePreimageCondition, type TrustTerms,
} from '../src/xrpl/codec.js';
import { tierFromScore } from '../src/kya/scorecard.js';
import type { PassportTier } from '../src/kya/tier.js';

describe('codec', () => {
  it('CRED_TYPE is hex of agent_trust_v1', () => {
    expect(CRED_TYPE).toBe('6167656E745F74727573745F7631');
  });
  it('LSF_ACCEPTED is 0x10000', () => {
    expect(LSF_ACCEPTED).toBe(65536);
  });
  it('hex round-trips', () => {
    expect(fromHex(toHex('hello world'))).toBe('hello world');
  });
  it('rippleEpoch subtracts 946684800', () => {
    expect(toRippleEpoch(946684800000 + 5000)).toBe(5);
  });
  it('invoiceId is 64 uppercase hex chars and deterministic', () => {
    const a = invoiceId('session-1');
    expect(a).toMatch(/^[0-9A-F]{64}$/);
    expect(invoiceId('session-1')).toBe(a);
    expect(invoiceId('session-2')).not.toBe(a);
  });
  it('dossierRef is 16 hex chars', () => {
    expect(dossierRef('kya:x')).toMatch(/^[0-9A-F]{16}$/);
  });
  it('trust URI round-trips and stays within 256 bytes', () => {
    const terms = { v: 1 as const, tier: 'TIER-2', maxTxAmount: '100', score: 65, exp: 900000000, ref: '23C9FE5AA800785C' };
    const hex = encodeTrustURI(terms);
    expect(hex.length).toBeLessThanOrEqual(256);
    expect(decodeTrustURI(hex)).toEqual(terms);
  });
  it('encodeTrustURI throws when payload exceeds 256 bytes', () => {
    const big = { v: 1 as const, tier: 'T', maxTxAmount: '1', score: 1, exp: 1, ref: 'x'.repeat(300) };
    expect(() => encodeTrustURI(big)).toThrow(/256/);
  });

  it('v2 URI round-trips with ih/sh/op8 and derives tier from score', () => {
    const t: TrustTerms = {
      v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp: 900000000,
      ref: '23C9FE5AA800785C', disposition: 'A', ih: 'AABBCCDD', sh: '11223344', op: 'DEADBEEF',
    };
    const hex = encodeTrustURI(t);
    expect(hex.length).toBeLessThanOrEqual(256);
    const back = decodeTrustURI(hex);
    expect(back).toEqual(t); // tier 'TIER-2' is re-derived from score 55
  });

  it('v2 on-the-wire payload uses abbreviated keys', () => {
    const t: TrustTerms = { v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp: 900000000, ref: 'AAAA', disposition: 'A', ih: 'AABBCCDD', sh: '11223344', op: 'DEADBEEF' };
    const wire = JSON.parse(fromHex(encodeTrustURI(t)));
    expect(Object.keys(wire).sort()).toEqual(['d', 'e', 'ih', 'm', 'op', 'r', 's', 'sh', 'v']);
  });

  it('v2 with ih+sh+op8 fits the 256-hex cap (spike budget)', () => {
    const exp = toRippleEpoch(946684800000) + 30 * 86400;
    const t: TrustTerms = { v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp, ref: dossierRef('mc:agent'), disposition: 'A', ih: 'AABBCCDD', sh: '11223344', op: 'DEADBEEF' };
    expect(encodeTrustURI(t).length).toBeLessThanOrEqual(256);
  });

  it('v1 verbose still round-trips unchanged (legacy)', () => {
    const t: TrustTerms = { v: 1, tier: 'TIER-2', maxTxAmount: '100', score: 65, exp: 900000000, ref: '23C9FE5AA800785C' };
    expect(decodeTrustURI(encodeTrustURI(t))).toEqual(t);
  });

  it('disposition defaults to D for a DENIED v2 cert', () => {
    const t: TrustTerms = { v: 2, tier: 'DENIED', maxTxAmount: '0', score: 10, exp: 900000000, ref: 'AAAA' };
    const back = decodeTrustURI(encodeTrustURI(t));
    expect(back.disposition).toBe('D');
    expect(back.tier).toBe('DENIED');
  });

  it('v2 without optional fields omits ih/sh/op from wire and decoded result', () => {
    const t: TrustTerms = { v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp: 900000000, ref: 'AAAA', disposition: 'A' };
    const wire = JSON.parse(fromHex(encodeTrustURI(t)));
    expect(wire).not.toHaveProperty('ih');
    expect(wire).not.toHaveProperty('sh');
    expect(wire).not.toHaveProperty('op');
    const back = decodeTrustURI(encodeTrustURI(t));
    expect(back).not.toHaveProperty('ih');
    expect(back).not.toHaveProperty('sh');
    expect(back).not.toHaveProperty('op');
  });

  it('v2 without explicit disposition decodes to the default (A for non-DENIED)', () => {
    const t: TrustTerms = { v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp: 900000000, ref: 'AAAA' };
    expect(decodeTrustURI(encodeTrustURI(t)).disposition).toBe('A');
  });

  it('v2 tier derivation is pinned to the scorecard bands', () => {
    expect(tierFromScore(55)).toBe('TIER-2');
  });

  // ── v3 tests (TASK 8) ────────────────────────────────────────────────────
  // v3 wire format omits `d` (disposition derived from tier on decode) and
  // uses `ch` as the single off-chain pointer (content hash doubles as ref).
  // This keeps the full payload within the 256-hex XLS-70 cap.

  // contentHash in v3 is a 12-hex prefix of the dossier SHA-256 (6 bytes),
  // chosen so the full wire payload (with ih+sh+op) stays within 256-hex.
  it('v3 round-trip: encode then decode returns the same object', () => {
    const t: TrustTerms = {
      v: 3,
      tier: 'GOLD',
      maxTxAmount: '2000',
      confidence: 87,
      dimsBitmask: 0b111111,
      exp: 900000000,
      contentHash: '23C9FE5AA800',   // 12 hex
      ih: 'AABBCCDD',
      sh: '11223344',
      op: 'DEADBEEF',
    };
    const hex = encodeTrustURI(t);
    const back = decodeTrustURI(hex);
    expect(back).toEqual(t);
  });

  it('v3 wire payload uses abbreviated keys', () => {
    const t: TrustTerms = {
      v: 3,
      tier: 'GOLD',
      maxTxAmount: '2000',
      confidence: 87,
      dimsBitmask: 0b111111,
      exp: 900000000,
      contentHash: 'ABCD1234ABCD',   // 12 hex
      ih: 'AABBCCDD',
      sh: '11223344',
      op: 'DEADBEEF',
    };
    const wire = JSON.parse(fromHex(encodeTrustURI(t)));
    // keys: v, t, c, dx, m, e, ch, ih, sh, op (no r, no d — derived from tier)
    expect(Object.keys(wire).sort()).toEqual(['c', 'ch', 'dx', 'e', 'ih', 'm', 'op', 'sh', 't', 'v']);
  });

  it('v3 tier char: D=DENIED, B=BRONZE, S=SILVER, G=GOLD, P=PLATINUM', () => {
    const tiers: Array<[PassportTier, string]> = [
      ['DENIED', 'D'], ['BRONZE', 'B'], ['SILVER', 'S'], ['GOLD', 'G'], ['PLATINUM', 'P'],
    ];
    for (const [tier, char] of tiers) {
      const t: TrustTerms = { v: 3, tier, maxTxAmount: '0', confidence: 0, dimsBitmask: 0, exp: 900000000, contentHash: 'ABCD1234ABCD' };
      const wire = JSON.parse(fromHex(encodeTrustURI(t)));
      expect(wire.t).toBe(char);
      const back = decodeTrustURI(encodeTrustURI(t));
      expect(back.tier).toBe(tier);
    }
  });

  it('v3 payload with all optional fields fits within 256 hex chars', () => {
    const exp = toRippleEpoch(946684800000) + 30 * 86400;
    const t: TrustTerms = {
      v: 3,
      tier: 'PLATINUM',
      maxTxAmount: '10000',
      confidence: 99,
      dimsBitmask: 0b111111,
      exp,
      contentHash: 'ABCD1234ABCD',   // 12 hex
      ih: 'AABBCCDD',
      sh: '11223344',
      op: 'DEADBEEF',
    };
    expect(encodeTrustURI(t).length).toBeLessThanOrEqual(256);
  });

  it('v3 decode returns { v:3, tier:"GOLD", confidence:87, dimsBitmask:63, ... }', () => {
    const t: TrustTerms = {
      v: 3, tier: 'GOLD', maxTxAmount: '2000', confidence: 87,
      dimsBitmask: 0b111111, exp: 900000000, contentHash: 'ABCD1234ABCD',
    };
    const back = decodeTrustURI(encodeTrustURI(t));
    expect(back.v).toBe(3);
    if (back.v !== 3) throw new Error('type guard');
    expect(back.tier).toBe('GOLD');
    expect(back.confidence).toBe(87);
    expect(back.dimsBitmask).toBe(63);
  });

  it('existing v1/v2 decoding is unaffected by v3 addition', () => {
    const v1: TrustTerms = { v: 1, tier: 'TIER-2', maxTxAmount: '100', score: 65, exp: 900000000, ref: '23C9FE5AA800785C' };
    const v2: TrustTerms = { v: 2, tier: 'TIER-2', maxTxAmount: '100', score: 55, exp: 900000000, ref: 'AAAA', disposition: 'A' };
    expect(decodeTrustURI(encodeTrustURI(v1)).v).toBe(1);
    expect(decodeTrustURI(encodeTrustURI(v2)).v).toBe(2);
  });
});

describe('makePreimageCondition (XLS-85 crypto-condition)', () => {
  it('matches the published five-bells vector for the empty preimage', () => {
    // ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU?fpt=preimage-sha-256&cost=0
    const { condition, fulfillment } = makePreimageCondition(Buffer.alloc(0));
    expect(fulfillment).toBe('A0028000');
    expect(condition).toBe(
      'A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100',
    );
  });

  it('encodes a 32-byte preimage with cost 0x20', () => {
    const preimage = Buffer.alloc(32, 7);
    const pHex = preimage.toString('hex').toUpperCase();
    const fp = createHash('sha256').update(preimage).digest('hex').toUpperCase();
    const c = makePreimageCondition(preimage);
    expect(c.preimage).toBe(pHex);
    expect(c.fulfillment).toBe('A0228020' + pHex);
    expect(c.condition).toBe('A0258020' + fp + '810120');
  });

  it('defaults to a fresh random 32-byte preimage each call', () => {
    const a = makePreimageCondition();
    const b = makePreimageCondition();
    expect(a.preimage).toMatch(/^[0-9A-F]{64}$/);
    expect(a.preimage).not.toBe(b.preimage);
    const fp = createHash('sha256').update(Buffer.from(a.preimage, 'hex')).digest('hex').toUpperCase();
    expect(a.condition).toBe('A0258020' + fp + '810120');
    expect(a.fulfillment).toBe('A0228020' + a.preimage);
  });
});
