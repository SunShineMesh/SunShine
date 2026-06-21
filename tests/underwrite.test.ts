import { describe, it, expect } from 'vitest';
import { underwrite } from '../src/kya/underwrite.js';
import { attest } from '../src/agent/attest.js';

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
});
