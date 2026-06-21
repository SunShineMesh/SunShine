import { describe, it, expect } from 'vitest';
import {
  computeTier,
  computeConfidence,
  effectiveCeiling,
  TIER_CEILING,
  type TierInput,
  type ConfidenceInput,
  type PassportTier,
} from '../src/kya/tier.js';

describe('computeTier', () => {
  const baseOrg: TierInput = {
    d1: true,
    d2: true,
    d3: true,
    d5Mandate: false,
    d6: 'PASS',
    principal: 'org',
    settlements: 0,
    windowDays: 0,
  };

  it('D1+D2+D3+D6=PASS, no history → BRONZE $100', () => {
    const result = computeTier(baseOrg);
    expect(result.tier).toBe('BRONZE');
    expect(result.ceiling).toBe('100');
  });

  it('BRONZE + D5 mandate + 10 settlements + 30d → SILVER $500', () => {
    const result = computeTier({ ...baseOrg, d5Mandate: true, settlements: 10, windowDays: 30 });
    expect(result.tier).toBe('SILVER');
    expect(result.ceiling).toBe('500');
  });

  it('SILVER + 30 settlements + 90d + 0.98 success rate → GOLD $2000', () => {
    const result = computeTier({
      ...baseOrg,
      d5Mandate: true,
      settlements: 30,
      windowDays: 90,
      successRate: 0.98,
    });
    expect(result.tier).toBe('GOLD');
    expect(result.ceiling).toBe('2000');
  });

  it('GOLD + 90d clean streak + BTIER-3 operator → PLATINUM $10000', () => {
    const result = computeTier({
      ...baseOrg,
      d5Mandate: true,
      settlements: 90,
      windowDays: 90,
      successRate: 0.98,
      cleanStreakDays: 90,
      operatorBtier: 'BTIER-3',
    });
    expect(result.tier).toBe('PLATINUM');
    expect(result.ceiling).toBe('10000');
  });

  it('AML hit → DENIED $0', () => {
    const result = computeTier({ ...baseOrg, amlHit: true });
    expect(result.tier).toBe('DENIED');
    expect(result.ceiling).toBe('0');
  });

  it('d6=DENY → DENIED $0', () => {
    const result = computeTier({ ...baseOrg, d6: 'DENY' });
    expect(result.tier).toBe('DENIED');
    expect(result.ceiling).toBe('0');
  });

  it('D1 false → DENIED $0', () => {
    const result = computeTier({ ...baseOrg, d1: false });
    expect(result.tier).toBe('DENIED');
    expect(result.ceiling).toBe('0');
  });

  it('D3 false → DENIED $0', () => {
    const result = computeTier({ ...baseOrg, d3: false });
    expect(result.tier).toBe('DENIED');
    expect(result.ceiling).toBe('0');
  });

  it('pseudonymous principal with D5 + many settlements → capped at BRONZE', () => {
    const result = computeTier({
      ...baseOrg,
      principal: 'pseudonymous',
      d5Mandate: true,
      settlements: 50,
      windowDays: 90,
    });
    expect(result.tier).toBe('BRONZE');
    expect(result.ceiling).toBe('100');
  });

  it('pseudonymous cap also applies when success rate and streaks would reach GOLD', () => {
    const result = computeTier({
      ...baseOrg,
      principal: 'pseudonymous',
      d5Mandate: true,
      settlements: 100,
      windowDays: 90,
      successRate: 0.99,
      cleanStreakDays: 90,
      operatorBtier: 'BTIER-3',
    });
    expect(result.tier).toBe('BRONZE');
    expect(result.ceiling).toBe('100');
  });

  it('exactly 10 settlements with D5 and 30d qualifies for SILVER', () => {
    const result = computeTier({ ...baseOrg, d5Mandate: true, settlements: 10, windowDays: 30 });
    expect(result.tier).toBe('SILVER');
  });

  it('9 settlements with D5 and 30d does NOT qualify for SILVER — stays BRONZE', () => {
    const result = computeTier({ ...baseOrg, d5Mandate: true, settlements: 9, windowDays: 30 });
    expect(result.tier).toBe('BRONZE');
  });

  it('29 settlements with D5 and 89d does NOT qualify for GOLD — stays SILVER', () => {
    const result = computeTier({
      ...baseOrg,
      d5Mandate: true,
      settlements: 29,
      windowDays: 89,
      successRate: 0.98,
    });
    expect(result.tier).toBe('SILVER');
  });

  it('SILVER but successRate 0.97 → stays SILVER (not GOLD)', () => {
    const result = computeTier({
      ...baseOrg,
      d5Mandate: true,
      settlements: 30,
      windowDays: 90,
      successRate: 0.97,
    });
    expect(result.tier).toBe('SILVER');
  });

  it('PLATINUM requires cleanStreakDays >= 90 and operatorBtier BTIER-3+', () => {
    // GOLD conditions met but no clean streak or operator tier → GOLD not PLATINUM
    const result = computeTier({
      ...baseOrg,
      d5Mandate: true,
      settlements: 90,
      windowDays: 90,
      successRate: 0.98,
    });
    expect(result.tier).toBe('GOLD');
  });

  it('individual principal is NOT pseudonymous — can reach SILVER', () => {
    const result = computeTier({
      ...baseOrg,
      principal: 'individual',
      d5Mandate: true,
      settlements: 10,
      windowDays: 30,
    });
    expect(result.tier).toBe('SILVER');
  });

  it('parent-agent principal is NOT pseudonymous — can reach SILVER', () => {
    const result = computeTier({
      ...baseOrg,
      principal: 'parent-agent',
      d5Mandate: true,
      settlements: 10,
      windowDays: 30,
    });
    expect(result.tier).toBe('SILVER');
  });
});

describe('TIER_CEILING', () => {
  it('has the correct ceiling values', () => {
    expect(TIER_CEILING.DENIED).toBe('0');
    expect(TIER_CEILING.BRONZE).toBe('100');
    expect(TIER_CEILING.SILVER).toBe('500');
    expect(TIER_CEILING.GOLD).toBe('2000');
    expect(TIER_CEILING.PLATINUM).toBe('10000');
  });
});

describe('computeConfidence', () => {
  it('all-zero inputs → 0', () => {
    const result = computeConfidence({ settlements: 0, windowDays: 0, daysSinceLastSettlement: 999 });
    expect(result).toBe(0);
  });

  it('saturated inputs (100 settlements, 90d window, 0 days since last) → 100', () => {
    const result = computeConfidence({ settlements: 100, windowDays: 90, daysSinceLastSettlement: 0 });
    expect(result).toBe(100);
  });

  it('50 settlements, 45 day window, 15 days since last → between 40 and 70', () => {
    const result = computeConfidence({ settlements: 50, windowDays: 45, daysSinceLastSettlement: 15 });
    expect(result).toBeGreaterThanOrEqual(40);
    expect(result).toBeLessThanOrEqual(70);
  });

  it('returns an integer (Math.round)', () => {
    const result = computeConfidence({ settlements: 33, windowDays: 60, daysSinceLastSettlement: 7 });
    expect(Number.isInteger(result)).toBe(true);
  });

  it('clamped at 100 even for over-saturated inputs', () => {
    const result = computeConfidence({ settlements: 1000, windowDays: 365, daysSinceLastSettlement: 0 });
    expect(result).toBe(100);
  });

  it('daysSinceLastSettlement=0 gives recency_score=1 (full)', () => {
    // settlement_score = 1, window_score = 1, recency = 1 → 100
    const result = computeConfidence({ settlements: 100, windowDays: 90, daysSinceLastSettlement: 0 });
    expect(result).toBe(100);
  });

  it('35 settlements, 90d window, 0 days → ≥60 (thick-file threshold check)', () => {
    const result = computeConfidence({ settlements: 35, windowDays: 90, daysSinceLastSettlement: 0 });
    expect(result).toBeGreaterThanOrEqual(60);
  });
});

describe('effectiveCeiling', () => {
  it('delegation budget wins when lower than tier ceiling', () => {
    const result = effectiveCeiling('GOLD', '2000', '1500');
    expect(result).toBe('1500');
  });

  it('tier ceiling wins when lower than delegation budget', () => {
    const result = effectiveCeiling('GOLD', '2000', '5000');
    expect(result).toBe('2000');
  });

  it('equal values returns the value', () => {
    const result = effectiveCeiling('SILVER', '500', '500');
    expect(result).toBe('500');
  });

  it('DENIED tier → always 0 regardless of budget', () => {
    const result = effectiveCeiling('DENIED', '0', '9999');
    expect(result).toBe('0');
  });

  it('BRONZE ceiling $100 < budget $200 → returns 100', () => {
    const result = effectiveCeiling('BRONZE', '100', '200');
    expect(result).toBe('100');
  });

  it('PLATINUM $10000 > budget $3000 → returns 3000', () => {
    const result = effectiveCeiling('PLATINUM', '10000', '3000');
    expect(result).toBe('3000');
  });
});
