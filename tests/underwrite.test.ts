import { describe, it, expect } from 'vitest';
import { underwrite } from '../src/kya/underwrite.js';
import { attest } from '../src/agent/attest.js';
import type { TrustTerms } from '../src/xrpl/codec.js';
import type { AmlMatcher } from '../src/kya/aml.js';

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

  // ── v3 review findings (TASK 8 fix) ───────────────────────────────────────

  it('v3: disposition is derived from tier (BRONZE→A, DENIED→D)', async () => {
    // Approved agent → disposition A
    const rApproved = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3 });
    const tApproved = rApproved.terms as Extract<TrustTerms, { v: 3 }>;
    expect(tApproved.disposition).toBe('A');
    // Denied agent → disposition D
    const rDenied = await underwrite(noChain, 'rAgent', {}, { now: NOW, version: 3 });
    const tDenied = rDenied.terms as Extract<TrustTerms, { v: 3 }>;
    expect(tDenied.disposition).toBe('D');
  });

  it('v3: amlResult option flows into dossier when supplied', async () => {
    const mockAmlResult = {
      hit: false, score: 0.1, matchedName: '', action: 'PASS' as const,
    };
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3, amlResult: mockAmlResult,
    });
    expect(r.dossier.amlResult).toBeDefined();
    expect(r.dossier.amlResult!.action).toBe('PASS');
    // D6 dimension should reflect the PASS from the AML result
    const d6 = r.dossier.dimensions?.find(d => d.id === 'D6');
    expect(d6).toBeDefined();
    expect(d6!.status).toBe('PASS');
  });

  it('v3: amlResult DENY result flows into D6 dimension status as DENY', async () => {
    const mockDenyResult = {
      hit: true, score: 0.95, matchedName: 'Viktor Bout', action: 'DENY' as const,
    };
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3, amlResult: mockDenyResult,
    });
    expect(r.dossier.amlResult).toBeDefined();
    expect(r.dossier.amlResult!.action).toBe('DENY');
    // D6 dimension should reflect DENY (the hard-gate status)
    const d6 = r.dossier.dimensions?.find(d => d.id === 'D6');
    expect(d6).toBeDefined();
    expect(d6!.status).toBe('DENY');
    // Critical security gate: AML DENY must produce a DENIED tier with $0 ceiling
    expect(r.terms.tier).toBe('DENIED');
    expect((r.terms as any).maxTxAmount).toBe('0');
  });

  it('v3: amlResult REVIEW flows into D6 as PENDING and still issues BRONZE (not DENIED)', async () => {
    const mockReviewResult = {
      hit: false, score: 0.6, matchedName: 'Similar Name', action: 'REVIEW' as const,
    };
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3, amlResult: mockReviewResult,
    });
    // D6 should be PENDING (not FAIL) for REVIEW
    const d6 = r.dossier.dimensions?.find(d => d.id === 'D6');
    expect(d6).toBeDefined();
    expect(d6!.status).toBe('PENDING');
    // REVIEW is acceptable for BRONZE issuance (tier.ts line 77 spec)
    expect(r.terms.tier).toBe('BRONZE');
    expect((r.terms as any).maxTxAmount).toBe('100');
    expect(r.terms.disposition).toBe('A');
  });

  // ── TASK 9: AML + principal wired into underwrite (integration) ────────────

  it('task9: amlName + mockDenyMatcher → DENIED tier, D6 status DENY', async () => {
    const mockDenyMatcher: AmlMatcher = (_name: string) => ({
      hit: true, score: 0.95, matchedName: 'Viktor Anatolijevitch BOUT', action: 'DENY' as const,
    });
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3,
      amlName: 'viktor bout',
      amlMatcher: mockDenyMatcher,
    });
    expect(r.decision.tier).toBe('DENIED');
    const d6 = r.dossier.dimensions?.find(d => d.id === 'D6');
    expect(d6).toBeDefined();
    expect(d6!.status).toBe('DENY');
    expect(r.terms.tier).toBe('DENIED');
    expect((r.terms as any).maxTxAmount).toBe('0');
  });

  it('task9: amlName alice muller + version 3 → NOT DENIED, D6 status PASS', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3,
      amlName: 'alice muller',
    });
    // Alice is clean — should not be DENIED
    expect(r.terms.tier).not.toBe('DENIED');
    const d6 = r.dossier.dimensions?.find(d => d.id === 'D6');
    expect(d6).toBeDefined();
    expect(d6!.status).toBe('PASS');
  });

  it('task9: pseudonymous principal → tier at most BRONZE', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, {
      now: NOW, version: 3,
      principal: { kind: 'pseudonymous' },
      d5Mandate: true,
      settlements: 50,
      windowDays: 90,
    });
    expect(r.terms.tier).toBe('BRONZE');
    expect((r.terms as any).maxTxAmount).toBe('100');
  });

  it('task9: d5Mandate + settlements=10 + windowDays=30 + D1/D2/D3 pass → SILVER', async () => {
    const r = await underwrite(noChain, 'rAgent', { ...demoOffChain, worldId: true }, {
      now: NOW, version: 3,
      d5Mandate: true,
      settlements: 10,
      windowDays: 30,
    });
    expect(r.terms.v).toBe(3);
    expect(r.terms.tier).toBe('SILVER');
    expect((r.terms as any).maxTxAmount).toBe('500');
  });

  it('task9: dossier dimensions array has exactly 6 entries (D1–D6)', async () => {
    const r = await underwrite(noChain, 'rAgent', demoOffChain, { now: NOW, version: 3 });
    expect(r.dossier.dimensions).toBeDefined();
    expect(r.dossier.dimensions!.length).toBe(6);
    const ids = r.dossier.dimensions!.map(d => d.id);
    expect(ids).toContain('D1');
    expect(ids).toContain('D2');
    expect(ids).toContain('D3');
    expect(ids).toContain('D4');
    expect(ids).toContain('D5');
    expect(ids).toContain('D6');
  });
});
