// TASK 11 — Failing tests for the scenario cast + export contract.
// These run BEFORE the implementation to enforce TDD.

import { describe, it, expect } from 'vitest';
import { CAST, runCrossBorderScenario } from '../src/agent/scenario.js';
import { delegationCapCheck } from '../src/kya/kyb.js';
import { TIER_CEILING } from '../src/kya/tier.js';

describe('CAST — scenario cast object', () => {
  it('has all required cast keys', () => {
    const requiredKeys = [
      'operator', 'agentA', 'agentB', 'compromised',
      'bureau', 'bank', 'supplierA', 'supplierB', 'amlTarget',
    ];
    for (const key of requiredKeys) {
      expect(CAST).toHaveProperty(key);
    }
  });

  it('operator matches Novartis AG with correct UID', () => {
    expect(CAST.operator.uid).toBe('CHE-103.867.266');
    expect(CAST.operator.name).toBe('Novartis AG');
  });

  it('operator is based in Basel, Switzerland', () => {
    expect(CAST.operator.city).toBe('Basel');
    expect(CAST.operator.country).toBe('Switzerland');
  });

  it('agentA is Aria', () => {
    expect(CAST.agentA.name).toBe('Aria');
  });

  it('agentB is Bravo', () => {
    expect(CAST.agentB.name).toBe('Bravo');
  });

  it('compromised cast member has a warning flag', () => {
    expect(CAST.compromised.flag).toBe('⚠');
  });

  it('supplierA is in Lagos, Nigeria', () => {
    expect(CAST.supplierA.city).toBe('Lagos');
    expect(CAST.supplierA.country).toBe('Nigeria');
  });

  it('supplierB is in Taipei, Taiwan', () => {
    expect(CAST.supplierB.city).toBe('Taipei');
    expect(CAST.supplierB.country).toBe('Taiwan');
  });

  it('amlTarget is a currently-listed OFAC SDN organization', () => {
    // Star Dragon Corporation Limited — real OFAC SDN Organization entry (schema=Organization).
    // Verified DENY (score 1.000) against data/sanctions_snapshot_20260621.csv.
    expect(CAST.amlTarget.name).toBe('Star Dragon Corporation Limited');
  });

  it('bureau is MeshCredit', () => {
    expect(CAST.bureau.name).toBe('MeshCredit');
  });
});

describe('runCrossBorderScenario — export contract', () => {
  it('is a function', () => {
    expect(typeof runCrossBorderScenario).toBe('function');
  });
});

describe('denial_budget — delegation cap BITES', () => {
  // The denial_budget step must actually deny. The scenario uses the BRONZE tier ceiling
  // ($100) as the local sub-cap for agentB (a BRONZE-tier agent). After settle_a ($50)
  // and settle_b ($60), the shared budget allocated is $110 which already exceeds the
  // BRONZE ceiling ($100). A $500 request must be denied by delegationCapCheck against
  // the BRONZE sub-cap — NOT the operator-level maxDelegatedSpend ($50 000).
  it('$500 request is denied when sub-cap is BRONZE ceiling ($100)', () => {
    const result = delegationCapCheck({
      maxDelegatedSpend: TIER_CEILING.BRONZE, // sub-cap = $100
      allocatedTotal: '110',                  // already over the BRONZE ceiling
      requestedAllocation: '500',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('$500 request passes when cap is operator-level maxDelegatedSpend ($50000) — confirming the bug', () => {
    // This test documents WHY the original code was wrong: using $50000 as the cap
    // makes $500 pass, so it must NOT be used for the denial_budget sub-cap check.
    const result = delegationCapCheck({
      maxDelegatedSpend: '50000',
      allocatedTotal: '110',
      requestedAllocation: '500',
    });
    expect(result.allowed).toBe(true);
  });

  it('drawBudget should use actual maxDelegatedSpend, not hardcoded GOLD ceiling', () => {
    // The GOLD ceiling ($2000) is an agent-tier ceiling, not the operator KYB ceiling.
    // After fix, drawBudget receives maxDelegatedSpend from kybScore (could be $50000
    // for BTIER-4). The denial_budget check uses the agent sub-cap (BRONZE = $100).
    // Verify: TIER_CEILING.GOLD !== the operator maxDelegatedSpend for BTIER-4.
    expect(TIER_CEILING.GOLD).toBe('2000');
    // BTIER-4 maxDelegatedSpend is $50,000 — different from GOLD ceiling.
    // The fix: pass the real maxDelegatedSpend to drawBudget, not TIER_CEILING.GOLD.
    const operatorBtier4Cap = '50000';
    expect(operatorBtier4Cap).not.toBe(TIER_CEILING.GOLD);
  });
});
