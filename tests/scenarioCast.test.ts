// TASK 11 — Failing tests for the scenario cast + export contract.
// These run BEFORE the implementation to enforce TDD.

import { describe, it, expect } from 'vitest';
import { CAST, runCrossBorderScenario } from '../src/agent/scenario.js';

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

  it('amlTarget is Viktor Bout', () => {
    expect(CAST.amlTarget.name).toBe('Viktor Bout');
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
