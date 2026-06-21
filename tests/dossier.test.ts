import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDossier, dossierRefOf, DossierStore, type DossierInput } from '../src/kya/dossier.js';
import { buildDimensionRecord, dimsBitmask, type DimensionRecord } from '../src/kya/dimension.js';

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

// ─── Task 6: DimensionRecord + dossier dimensions ────────────────────────────

describe('DimensionRecord', () => {
  const d1Rec = buildDimensionRecord('D1', {
    issuer: 'Zefix',
    status: 'PASS',
    evidenceRef: 'CHE-103.867.266',
    evidenceHash: 'a'.repeat(64),
    details: { uid: 'CHE-103.867.266', status: 'ACTIVE' },
    checkedAt: 1_700_000_000_000,
  });

  it('buildDimensionRecord returns a valid DimensionRecord shape', () => {
    expect(d1Rec.id).toBe('D1');
    expect(d1Rec.status).toBe('PASS');
    expect(d1Rec.issuer).toBe('Zefix');
    expect(d1Rec.evidenceRef).toBe('CHE-103.867.266');
    expect(d1Rec.evidenceHash).toBe('a'.repeat(64));
    expect(d1Rec.details).toEqual({ uid: 'CHE-103.867.266', status: 'ACTIVE' });
    expect(d1Rec.checkedAt).toBe(1_700_000_000_000);
  });

  it('D6 dimension with status DENY exposes action in details', () => {
    const d6Rec = buildDimensionRecord('D6', {
      issuer: 'OFAC SDN',
      status: 'DENY',
      evidenceRef: 'viktor-bout-ofac-id',
      evidenceHash: 'b'.repeat(64),
      details: { action: 'DENY', matchedName: 'viktor bout' },
      checkedAt: 1_700_000_001_000,
    });
    expect(d6Rec.id).toBe('D6');
    expect(d6Rec.status).toBe('DENY');
    expect(d6Rec.details.action).toBe('DENY');
  });

  it('a dossier built with dimensions has a different ref than one without', () => {
    const dims: DimensionRecord[] = [d1Rec];
    const withDims = dossierRefOf({ ...input, dimensions: dims });
    const withoutDims = dossierRefOf(input);
    expect(withDims).not.toBe(withoutDims);
  });

  it('changing evidenceHash in any dimension changes the dossier ref', () => {
    const dimA = buildDimensionRecord('D1', {
      issuer: 'Zefix',
      status: 'PASS',
      evidenceRef: 'CHE-103.867.266',
      evidenceHash: 'a'.repeat(64),
      details: {},
      checkedAt: 1_700_000_000_000,
    });
    const dimB = buildDimensionRecord('D1', {
      issuer: 'Zefix',
      status: 'PASS',
      evidenceRef: 'CHE-103.867.266',
      evidenceHash: 'c'.repeat(64), // different hash
      details: {},
      checkedAt: 1_700_000_000_000,
    });
    const refA = dossierRefOf({ ...input, dimensions: [dimA] });
    const refB = dossierRefOf({ ...input, dimensions: [dimB] });
    expect(refA).not.toBe(refB);
  });
});

describe('dimsBitmask', () => {
  it('empty dims array yields 0', () => {
    expect(dimsBitmask([])).toBe(0);
  });

  it('D1 alone is bit 0 (value 1)', () => {
    const rec = buildDimensionRecord('D1', {
      issuer: 'Zefix', status: 'PASS', evidenceRef: 'uid', evidenceHash: 'a'.repeat(64),
      details: {}, checkedAt: 0,
    });
    expect(dimsBitmask([rec])).toBe(0b000001);
  });

  it('D6 alone is bit 5 (value 32)', () => {
    const rec = buildDimensionRecord('D6', {
      issuer: 'OFAC SDN', status: 'PASS', evidenceRef: 'none', evidenceHash: 'b'.repeat(64),
      details: {}, checkedAt: 0,
    });
    expect(dimsBitmask([rec])).toBe(0b100000);
  });

  it('all six PASS dims yields 0b111111 (63)', () => {
    const ids = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const;
    const recs = ids.map((id) =>
      buildDimensionRecord(id, {
        issuer: 'Test', status: 'PASS', evidenceRef: 'ref', evidenceHash: 'a'.repeat(64),
        details: {}, checkedAt: 0,
      })
    );
    expect(dimsBitmask(recs)).toBe(0b111111);
  });

  it('FAIL and PENDING statuses are NOT set in the bitmask', () => {
    const rec = buildDimensionRecord('D2', {
      issuer: 'World ID', status: 'FAIL', evidenceRef: 'none', evidenceHash: 'c'.repeat(64),
      details: {}, checkedAt: 0,
    });
    // D2 bit = bit 1 (value 2), but FAIL → not set
    expect(dimsBitmask([rec])).toBe(0);
  });

  it('DENY status is NOT set in the bitmask', () => {
    const rec = buildDimensionRecord('D6', {
      issuer: 'OFAC SDN', status: 'DENY', evidenceRef: 'hit', evidenceHash: 'd'.repeat(64),
      details: {}, checkedAt: 0,
    });
    expect(dimsBitmask([rec])).toBe(0);
  });
});
