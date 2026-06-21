import { describe, it, expect } from 'vitest';
import {
  kybScore,
  delegationCapCheck,
  type KybSignals,
  type KybDecision,
  type AggCapInput,
  type AggCapResult,
} from '../src/kya/kyb.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const denied: KybSignals = {
  entityVerified: false,
  businessAgeDays: 0,
  registeredJurisdiction: 'XX',
  operatorSettlementRate: 0,
};

const minimal: KybSignals = {
  entityVerified: true,
  businessAgeDays: 0,
  registeredJurisdiction: 'CH',
  operatorSettlementRate: 0,
};

const moderate: KybSignals = {
  entityVerified: true,
  businessAgeDays: 365,
  registeredJurisdiction: 'CH',
  operatorSettlementRate: 0.5,
};

const strong: KybSignals = {
  entityVerified: true,
  businessAgeDays: 365,
  registeredJurisdiction: 'CH',
  operatorSettlementRate: 0.8,
};

const perfect: KybSignals = {
  entityVerified: true,
  businessAgeDays: 1460,
  registeredJurisdiction: 'CH',
  operatorSettlementRate: 1,
};

// ── kybScore: tier boundaries ────────────────────────────────────────────────

describe('kybScore', () => {
  it('unverified entity → DENIED tier, maxDelegatedSpend 0', () => {
    const d = kybScore(denied);
    expect(d.btier).toBe('DENIED');
    expect(d.maxDelegatedSpend).toBe('0');
  });

  it('verified entity alone (age=0, repay=0) → BTIER-1, maxDelegatedSpend 500', () => {
    const d = kybScore(minimal);
    expect(d.btier).toBe('BTIER-1');
    expect(d.maxDelegatedSpend).toBe('500');
  });

  it('moderate signals → BTIER-2 or higher, maxDelegatedSpend >= 2500', () => {
    const d = kybScore(moderate);
    expect(['BTIER-2', 'BTIER-3', 'BTIER-4']).toContain(d.btier);
    expect(Number(d.maxDelegatedSpend)).toBeGreaterThanOrEqual(2500);
  });

  it('strong signals → BTIER-3, maxDelegatedSpend 10000', () => {
    const d = kybScore(strong);
    expect(d.btier).toBe('BTIER-3');
    expect(d.maxDelegatedSpend).toBe('10000');
  });

  it('perfect signals → BTIER-4, maxDelegatedSpend 50000', () => {
    const d = kybScore(perfect);
    expect(d.btier).toBe('BTIER-4');
    expect(d.maxDelegatedSpend).toBe('50000');
  });

  it('returns numeric maxDelegatedSpend as string (parseable)', () => {
    const d = kybScore(perfect);
    expect(Number.isFinite(Number(d.maxDelegatedSpend))).toBe(true);
  });

  it('unrecognised jurisdiction treated as no bonus, still tiers on other signals', () => {
    const unknown: KybSignals = { ...perfect, registeredJurisdiction: 'ZZ' };
    const d = kybScore(unknown);
    // Should still score high, just slightly lower than CH equivalent
    expect(['BTIER-3', 'BTIER-4']).toContain(d.btier);
  });

  it('businessAgeDays clamps at maximum contribution (≥ 1460 days = full)', () => {
    const over: KybSignals = { ...perfect, businessAgeDays: 9999 };
    const same: KybSignals = { ...perfect, businessAgeDays: 1460 };
    expect(kybScore(over).maxDelegatedSpend).toBe(kybScore(same).maxDelegatedSpend);
    expect(kybScore(over).btier).toBe(kybScore(same).btier);
  });

  it('operatorSettlementRate of 1 gives full repay bonus', () => {
    const withRepay: KybSignals = { ...minimal, operatorSettlementRate: 1 };
    const noRepay: KybSignals = { ...minimal, operatorSettlementRate: 0 };
    expect(Number(kybScore(withRepay).maxDelegatedSpend)).toBeGreaterThan(Number(kybScore(noRepay).maxDelegatedSpend));
  });
});

// ── delegationCapCheck ────────────────────────────────────────────────────────

describe('delegationCapCheck', () => {
  it('under limit → allowed', () => {
    const r = delegationCapCheck({ maxDelegatedSpend: '10000', allocatedTotal: '3000', requestedAllocation: '2000' });
    expect(r.allowed).toBe(true);
  });

  it('exactly at limit → allowed', () => {
    const r = delegationCapCheck({ maxDelegatedSpend: '10000', allocatedTotal: '8000', requestedAllocation: '2000' });
    expect(r.allowed).toBe(true);
  });

  it('one cent over limit → denied', () => {
    const r = delegationCapCheck({ maxDelegatedSpend: '10000', allocatedTotal: '8000', requestedAllocation: '2000.01' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/exceed/i);
  });

  it('zero outstanding + requestedAllocation > maxDelegatedSpend → denied', () => {
    const r = delegationCapCheck({ maxDelegatedSpend: '500', allocatedTotal: '0', requestedAllocation: '501' });
    expect(r.allowed).toBe(false);
  });

  it('maxDelegatedSpend 0 → always denied', () => {
    const r = delegationCapCheck({ maxDelegatedSpend: '0', allocatedTotal: '0', requestedAllocation: '1' });
    expect(r.allowed).toBe(false);
  });

  it('reason field present when denied, undefined when allowed', () => {
    const denied = delegationCapCheck({ maxDelegatedSpend: '100', allocatedTotal: '90', requestedAllocation: '20' });
    const allowed = delegationCapCheck({ maxDelegatedSpend: '100', allocatedTotal: '80', requestedAllocation: '20' });
    expect(denied.reason).toBeDefined();
    expect(allowed.reason).toBeUndefined();
  });
});
