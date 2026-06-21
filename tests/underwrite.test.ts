import { describe, it, expect } from 'vitest';
import { underwrite } from '../src/kya/underwrite.js';
import { attest } from '../src/agent/attest.js';
import type { TrustTerms } from '../src/xrpl/codec.js';

const noChain = { request: async () => { throw new Error('actNotFound'); } } as any; // -> readOnChainSignals returns {}
const demoOffChain = { worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true };
const NOW = 1_700_000_000_000;

describe('underwrite', () => {
  it('operator-backed demo agent → v2 TIER-2 cert with consistent ceiling', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW });
    expect(r.decision.score).toBe(55);
    expect(r.terms.v).toBe(2);
    expect(r.terms.tier).toBe('TIER-2');
    expect(r.terms.maxTxAmount).toBe('100');
    expect(r.terms.disposition).toBe('A');
    expect(r.terms.ih).toBeUndefined();
    expect(r.terms.sh).toBeUndefined();
    expect(r.terms.op).toBeUndefined();
  });
  it('embeds ih/sh from attestation and op8 from the operator cred id', async () => {
    const att = attest('harness', 'skill');
    const opCredId = 'C0FFEE1234567890'.repeat(4); // 64 hex
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, attestation: att, operatorCredId: opCredId });
    expect(r.terms.ih).toBe(att.ih);
    expect(r.terms.sh).toBe(att.sh);
    expect(r.terms.op).toBe(opCredId.slice(0, 8));
  });
  it('ties on-ledger ref to the dossier content hash', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW });
    expect(r.terms.ref).toBe(r.dossier.ref);
    expect(r.dossier.score).toBe(55);
  });
  it('a denied agent yields disposition D', async () => {
    const r = await underwrite(noChain, 'rAgent', {}, { now: NOW });
    expect(r.decision.tier).toBe('DENIED');
    expect(r.terms.disposition).toBe('D');
  });

  // ── v3 path tests (TASK 8) ─────────────────────────────────────────────────
  it('v3: operator-backed agent with d1/d2/d3 → BRONZE cert', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3 });
    expect(r.terms.v).toBe(3);
    const t = r.terms as Extract<TrustTerms, { v: 3 }>;
    expect(t.tier).toBe('BRONZE');
    expect(typeof t.confidence).toBe('number');
    expect(t.confidence).toBeGreaterThanOrEqual(0);
    expect(t.confidence).toBeLessThanOrEqual(100);
    expect(typeof t.dimsBitmask).toBe('number');
    expect(typeof t.contentHash).toBe('string');
    expect(t.contentHash.length).toBeGreaterThan(0);
    expect(t.maxTxAmount).toBe('100');
  });

  it('v3: contentHash is a prefix of dossier ref', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3 });
    // v3 uses contentHash (12-hex prefix of dossier ref) as the dossier pointer
    const t = r.terms as Extract<TrustTerms, { v: 3 }>;
    expect(r.dossier.ref.startsWith(t.contentHash)).toBe(true);
  });

  it('v3: silver when d5Mandate=true, settlements=10, windowDays=30', async () => {
    const r = await underwrite(noChain, 'rAgent', { ...demoOffChain, worldId: true }, {
      now: NOW, version: 3, d5Mandate: true, settlements: 10, windowDays: 30,
    });
    expect(r.terms.v).toBe(3);
    const t = r.terms as Extract<TrustTerms, { v: 3 }>;
    expect(t.tier).toBe('SILVER');
    expect(t.maxTxAmount).toBe('500');
  });

  it('v3: contentHash present and is prefix of dossier ref', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3 });
    const t = r.terms as Extract<TrustTerms, { v: 3 }>;
    // In v3, contentHash is a 12-hex prefix of the dossier ref
    expect(t.contentHash).toBeTruthy();
    expect(t.contentHash.length).toBe(12);
    expect(r.dossier.ref.startsWith(t.contentHash)).toBe(true);
  });

  it('v3: fits within 256-hex XLS-70 cap', async () => {
    const { encodeTrustURI } = await import('../src/xrpl/codec.js');
    const att = attest('harness', 'skill');
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3, attestation: att, operatorCredId: 'C0FFEE1234567890'.repeat(4) });
    expect(() => encodeTrustURI(r.terms)).not.toThrow();
    expect(encodeTrustURI(r.terms).length).toBeLessThanOrEqual(256);
  });
});
