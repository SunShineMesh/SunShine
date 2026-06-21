import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDossier, dossierRefOf, DossierStore, type DossierInput } from '../src/kya/dossier.js';

const input: DossierInput = {
  agentAddr: 'rAgentXXXXXXXXXXXXXXXXXXXXXXXXXX',
  operatorCredId: 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  harnessHashFull: 'A'.repeat(64),
  skillHashFull: 'B'.repeat(64),
  score: 55,
  tier: 'TIER-2',
  signals: {
    worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true,
    accountAgeDays: 0, rlusdPayments: 0, escrowCompletionRate: 0, priorPaymentSuccessRate: 0,
    humanDidComplete: true, operatorBacked: true,
  },
  screening: { sanctions: 'stub', pep: 'stub', provider: 'demo-stub' },
  createdAt: 1_700_000_000_000,
};

describe('dossier', () => {
  it('dossierRefOf is 16 uppercase hex and deterministic', () => {
    const ref = dossierRefOf(input);
    expect(ref).toMatch(/^[0-9A-F]{16}$/);
    expect(dossierRefOf(input)).toBe(ref);
  });
  it('changing any content changes the ref (content-addressed)', () => {
    expect(dossierRefOf({ ...input, score: 56 })).not.toBe(dossierRefOf(input));
  });
  it('buildDossier sets ref to the content hash', () => {
    const d = buildDossier(input);
    expect(d.ref).toBe(dossierRefOf(input));
    expect(d.agentAddr).toBe(input.agentAddr);
  });
  it('ref binds nested signals/screening content (no collision on nested-only change)', () => {
    const a = buildDossier(input);
    const flippedSignals = buildDossier({ ...input, signals: { ...input.signals, worldId: !input.signals.worldId } });
    const changedScreening = buildDossier({ ...input, screening: { ...input.screening, sanctions: 'hit' } });
    expect(flippedSignals.ref).not.toBe(a.ref);
    expect(changedScreening.ref).not.toBe(a.ref);
  });
  it('DossierStore round-trips by ref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dossier-'));
    try {
      const store = new DossierStore(join(dir, '.dossiers.json'));
      const d = buildDossier(input);
      store.put(d);
      expect(store.get(d.ref)).toEqual(d);
      expect(store.get('NOPE')).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
