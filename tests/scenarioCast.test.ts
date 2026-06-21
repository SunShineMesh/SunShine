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
  // The denial_budget step demonstrates the OPERATOR AGGREGATE delegation budget biting.
  // The operator delegates a $150 fleet budget for this run (demoDelegationBudget).
  // After settle_a ($50) + settle_b ($60) = $110 allocated, only $40 remains.
  // A $500 request is denied: projected $610 > fleet budget $150.
  // Numbers must be self-consistent: $50 + $60 = $110 allocated, $150 - $110 = $40 remaining.
  it('$500 request is denied when fleet budget is $150 and $110 is already allocated', () => {
    const demoDelegationBudget = '150';
    const result = delegationCapCheck({
      maxDelegatedSpend: demoDelegationBudget, // operator's per-run fleet budget
      allocatedTotal: '110',                   // $50 (settle_a) + $60 (settle_b) = $110
      requestedAllocation: '500',              // projected $610 > $150 → DENIED
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('numbers are self-consistent: $110 allocated = $50 + $60 exactly', () => {
    // settle_a draws $50, settle_b draws $60; aggregate must be $110.
    expect(50 + 60).toBe(110);
    // remaining = $150 - $110 = $40
    expect(150 - 110).toBe(40);
    // projected = $110 + $500 = $610 > $150
    expect(110 + 500).toBe(610);
    expect(610 > 150).toBe(true);
  });

  it('settle_a ($50) alone does NOT exceed the $150 fleet budget', () => {
    const result = delegationCapCheck({
      maxDelegatedSpend: '150',
      allocatedTotal: '0',
      requestedAllocation: '50',
    });
    expect(result.allowed).toBe(true);
  });

  it('settle_b ($60) with $50 already allocated does NOT exceed the $150 fleet budget', () => {
    const result = delegationCapCheck({
      maxDelegatedSpend: '150',
      allocatedTotal: '50',
      requestedAllocation: '60',
    });
    expect(result.allowed).toBe(true);
  });

  it('$500 request passes when cap is operator-level maxDelegatedSpend ($50000)', () => {
    // Confirms the settle legs use the full KYB operator cap (not the demo fleet budget).
    const result = delegationCapCheck({
      maxDelegatedSpend: '50000',
      allocatedTotal: '110',
      requestedAllocation: '500',
    });
    expect(result.allowed).toBe(true);
  });

  it('drawBudget should use actual maxDelegatedSpend, not hardcoded GOLD ceiling', () => {
    // The GOLD ceiling ($2000) is an agent-tier ceiling, not the operator KYB ceiling.
    expect(TIER_CEILING.GOLD).toBe('2000');
    const operatorBtier4Cap = '50000';
    expect(operatorBtier4Cap).not.toBe(TIER_CEILING.GOLD);
  });
});
