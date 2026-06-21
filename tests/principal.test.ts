// Principal model tests (Task 2) — written BEFORE the implementation (TDD).
//
// Tests the discriminated union Principal and verifyControlProof pure function.
// No I/O; entirely pure logic.

import { describe, it, expect } from 'vitest';
import {
  verifyControlProof,
  delegationDepth,
  principalIsPseudonymous,
  type PrincipalKind,
  type OrgPrincipal,
  type IndividualPrincipal,
  type ParentAgentPrincipal,
  type PseudonymousPrincipal,
  type Principal,
  type ControlProofResult,
} from '../src/kya/principal.js';

// ─── Type-level checks ────────────────────────────────────────────────────────

describe('PrincipalKind values', () => {
  it("accepts 'org' as a valid kind", () => {
    const kind: PrincipalKind = 'org';
    expect(kind).toBe('org');
  });

  it("accepts 'individual' as a valid kind", () => {
    const kind: PrincipalKind = 'individual';
    expect(kind).toBe('individual');
  });

  it("accepts 'parent-agent' as a valid kind", () => {
    const kind: PrincipalKind = 'parent-agent';
    expect(kind).toBe('parent-agent');
  });

  it("accepts 'pseudonymous' as a valid kind", () => {
    const kind: PrincipalKind = 'pseudonymous';
    expect(kind).toBe('pseudonymous');
  });
});

// ─── verifyControlProof — org with valid counterSig ───────────────────────────

describe('verifyControlProof — org', () => {
  const agentKey = 'rAgent1234567890ABCDEF';

  it('org with counterSig → { valid: true, chain: [...] }', () => {
    const principal: OrgPrincipal = {
      kind: 'org',
      uid: 'CHE-103.867.266',
      registryVerified: true,
      controlProofToken: 'dns-challenge-abc123',
      counterSig: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    };
    const result: ControlProofResult = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.chain)).toBe(true);
    expect(result.cappedToLowest).toBeFalsy();
  });

  it('org missing counterSig → { valid: false, reason: <counter-signature message> }', () => {
    const principal: OrgPrincipal = {
      kind: 'org',
      uid: 'CHE-103.867.266',
      registryVerified: true,
      // counterSig intentionally absent
    };
    const result: ControlProofResult = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/counter-signature/i);
    expect(result.reason).toMatch(/principal cannot back this agent/i);
  });

  it('org with empty counterSig string → { valid: false }', () => {
    const principal: OrgPrincipal = {
      kind: 'org',
      uid: 'CHE-103.867.266',
      registryVerified: true,
      counterSig: '',
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(false);
  });
});

// ─── verifyControlProof — individual ─────────────────────────────────────────

describe('verifyControlProof — individual', () => {
  const agentKey = 'rAgent1234567890ABCDEF';

  it('individual with counterSig → { valid: true }', () => {
    const principal: IndividualPrincipal = {
      kind: 'individual',
      nullifierHash: '0xdeadbeef1234',
      counterSig: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb',
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(true);
  });

  it('individual missing counterSig → { valid: false }', () => {
    const principal: IndividualPrincipal = {
      kind: 'individual',
      nullifierHash: '0xdeadbeef1234',
      // counterSig absent
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/counter-signature/i);
  });
});

// ─── verifyControlProof — pseudonymous ───────────────────────────────────────

describe('verifyControlProof — pseudonymous', () => {
  it('pseudonymous kind → { valid: true, cappedToLowest: true }', () => {
    const principal: PseudonymousPrincipal = { kind: 'pseudonymous' };
    const result = verifyControlProof(principal, 'rAnyKey');
    expect(result.valid).toBe(true);
    expect(result.cappedToLowest).toBe(true);
  });
});

// ─── verifyControlProof — parent-agent ───────────────────────────────────────

describe('verifyControlProof — parent-agent', () => {
  const agentKey = 'rChildAgent0001';

  it('parent-agent with delegationSig and chain → { valid: true, chain: [...] }', () => {
    const principal: ParentAgentPrincipal = {
      kind: 'parent-agent',
      parentCredId: 'cred-parent-001',
      delegationSig: 'sigparent00112233445566778899aabbccddeeff00112233445566778899aabb',
      chain: ['rHuman', 'rParentAgent'],
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.chain)).toBe(true);
    expect((result.chain as string[]).length).toBeGreaterThan(0);
  });

  it('parent-agent missing delegationSig → { valid: false }', () => {
    const principal: ParentAgentPrincipal = {
      kind: 'parent-agent',
      parentCredId: 'cred-parent-001',
      // delegationSig absent
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('parent-agent with empty delegationSig → { valid: false }', () => {
    const principal: ParentAgentPrincipal = {
      kind: 'parent-agent',
      parentCredId: 'cred-parent-001',
      delegationSig: '',
    };
    const result = verifyControlProof(principal, agentKey);
    expect(result.valid).toBe(false);
  });
});

// ─── delegationDepth ──────────────────────────────────────────────────────────

describe('delegationDepth', () => {
  it('empty chain → 0', () => {
    expect(delegationDepth([])).toBe(0);
  });

  it('chain of 1 → 1', () => {
    expect(delegationDepth(['rHuman'])).toBe(1);
  });

  it('chain of 3 → 3', () => {
    expect(delegationDepth(['rHuman', 'rParent', 'rChild'])).toBe(3);
  });

  it('chain of 5 → 5', () => {
    expect(delegationDepth(['a', 'b', 'c', 'd', 'e'])).toBe(5);
  });
});

// ─── principalIsPseudonymous ──────────────────────────────────────────────────

describe('principalIsPseudonymous', () => {
  it('pseudonymous → true', () => {
    const p: Principal = { kind: 'pseudonymous' };
    expect(principalIsPseudonymous(p)).toBe(true);
  });

  it('org → false', () => {
    const p: Principal = { kind: 'org', uid: 'CHE-103.867.266', registryVerified: true };
    expect(principalIsPseudonymous(p)).toBe(false);
  });

  it('individual → false', () => {
    const p: Principal = { kind: 'individual' };
    expect(principalIsPseudonymous(p)).toBe(false);
  });

  it('parent-agent → false', () => {
    const p: Principal = { kind: 'parent-agent', parentCredId: 'cred-001' };
    expect(principalIsPseudonymous(p)).toBe(false);
  });
});

// ─── Type structural checks ────────────────────────────────────────────────────

describe('Principal discriminated union shape', () => {
  it('OrgPrincipal has required fields: kind, uid, registryVerified', () => {
    const p: OrgPrincipal = {
      kind: 'org',
      uid: 'CHE-103.867.266',
      registryVerified: true,
    };
    expect(p.kind).toBe('org');
    expect(p.uid).toBe('CHE-103.867.266');
    expect(p.registryVerified).toBe(true);
  });

  it('IndividualPrincipal has kind = "individual"', () => {
    const p: IndividualPrincipal = { kind: 'individual' };
    expect(p.kind).toBe('individual');
  });

  it('ParentAgentPrincipal has required parentCredId', () => {
    const p: ParentAgentPrincipal = {
      kind: 'parent-agent',
      parentCredId: 'cred-123',
    };
    expect(p.parentCredId).toBe('cred-123');
  });

  it('PseudonymousPrincipal has only kind = "pseudonymous"', () => {
    const p: PseudonymousPrincipal = { kind: 'pseudonymous' };
    expect(p.kind).toBe('pseudonymous');
  });
});
