import { describe, it, expect } from 'vitest';
import { score, decide, tierFromScore, maxTxForTier, type Signals } from '../src/kya/scorecard.js';

const base: Signals = {
  worldId: false, runtimeStable: false, transcriptCoherent: false, sourceProvided: false,
  accountAgeDays: 0, rlusdPayments: 0, escrowCompletionRate: 0, priorPaymentSuccessRate: 0, humanDidComplete: false,
};

describe('scorecard', () => {
  it('all-zero signals → 0 → DENIED', () => {
    expect(score(base)).toBe(0);
    expect(decide(base).tier).toBe('DENIED');
  });
  it('perfect signals → 100 → TIER-4 ($2000 maxTxAmount)', () => {
    const perfect: Signals = {
      worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true,
      accountAgeDays: 60, rlusdPayments: 50, escrowCompletionRate: 1, priorPaymentSuccessRate: 1, humanDidComplete: true,
    };
    expect(score(perfect)).toBe(100);
    const d = decide(perfect);
    expect(d.tier).toBe('TIER-4'); expect(d.maxTxAmount).toBe('2000');
  });
  it('worldId alone = 15 points', () => {
    expect(score({ ...base, worldId: true })).toBe(15);
  });
  it('mid profile lands TIER-2', () => {
    const mid: Signals = { ...base, worldId: true, runtimeStable: true, transcriptCoherent: true, accountAgeDays: 30, rlusdPayments: 10, escrowCompletionRate: 0.5 };
    const d = decide(mid);
    expect(d.score).toBeGreaterThanOrEqual(50);
    expect(d.score).toBeLessThan(70);
    expect(d.tier).toBe('TIER-2');
  });
  it('rlusdPayments points cap at 15', () => {
    expect(score({ ...base, rlusdPayments: 999 })).toBe(15);
  });
});

describe('tierFromScore / maxTxForTier', () => {
  it('maps score bands to tiers', () => {
    expect(tierFromScore(0)).toBe('DENIED');
    expect(tierFromScore(45)).toBe('TIER-1');
    expect(tierFromScore(55)).toBe('TIER-2');
    expect(tierFromScore(80)).toBe('TIER-3');
    expect(tierFromScore(90)).toBe('TIER-4');
  });
  it('maps tiers to ceilings', () => {
    expect(maxTxForTier('TIER-1')).toBe('25');
    expect(maxTxForTier('TIER-2')).toBe('100');
    expect(maxTxForTier('DENIED')).toBe('0');
    expect(maxTxForTier('TIER-3')).toBe('500');
    expect(maxTxForTier('TIER-4')).toBe('2000');
  });
});

describe('operatorBacked signal (honest TIER-floor fix)', () => {
  it('operatorBacked alone adds 10 points', () => {
    expect(score({ ...base, operatorBacked: true })).toBe(10);
  });
  it('the 5 demo booleans + operatorBacked legitimately reach TIER-2', () => {
    const demo: Signals = { ...base, worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true };
    const d = decide(demo);
    expect(d.score).toBe(55);
    expect(d.tier).toBe('TIER-2');
    expect(d.maxTxAmount).toBe('100');
  });
});
