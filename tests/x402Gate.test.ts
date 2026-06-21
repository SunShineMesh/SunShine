// TASK 13 — Phase 1.5: x402 gate middleware
// TDD: these tests are written FIRST and must run red before implementation.

import { describe, it, expect } from 'vitest';
import {
  checkPassportForX402,
  buildX402Response,
  type X402Requirements,
  type X402GateResult,
} from '../src/x402/gate.js';

const BASE_REQUIREMENTS: X402Requirements = {
  amount: '50',
  currency: 'RLUSD',
  credentialIssuer: 'MeshCredit',
  requiredTier: 'BRONZE',
  paymentAddress: 'rMeshCreditTreasury0000000000',
};

describe('checkPassportForX402', () => {
  it('allows valid credential with passing AML and amount within tier ceiling', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rValid',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(402);
    expect(result.released).toBe(true);
  });

  it('denies when credential is missing', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rNoCredential',
      credentialStatus: 'missing',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('no valid MeshCredit credential');
  });

  it('denies when credential is revoked', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rRevoked',
      credentialStatus: 'revoked',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('no valid MeshCredit credential');
  });

  it('denies when requested amount exceeds tier ceiling', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rValid',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '600',
      amlResult: 'PASS',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('amount exceeds tier ceiling');
  });

  it('denies when amount exactly equals ceiling — allowed (boundary inclusive)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rValid',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '500',
      amlResult: 'PASS',
    });
    expect(result.allowed).toBe(true);
  });

  it('denies when AML result is DENY', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rViktor',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'DENY',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('AML screening DENY');
  });

  it('allows when AML result is REVIEW (not a hard block)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rReview',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'REVIEW',
    });
    // REVIEW is not a hard deny in x402 gate (unlike the credential issuance gate)
    expect(result.allowed).toBe(true);
  });

  it('checks AML before tier ceiling (AML denial takes priority)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rViktor',
      credentialStatus: 'valid',
      tierCeiling: '500',
      // Amount over ceiling AND AML DENY — AML should fire first
      requestedAmount: '600',
      amlResult: 'DENY',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('AML screening DENY');
  });
});

describe('buildX402Response', () => {
  it('returns status 402 with required headers and body', () => {
    const response = buildX402Response(BASE_REQUIREMENTS);
    expect(response.status).toBe(402);
    expect(response.headers).toBeDefined();
    expect(response.headers['X-Payment-Required']).toBeDefined();
    expect(response.headers['X-Payment-Schemes']).toBe('RLUSD/XRPL');
    expect(response.body).toBeDefined();
    expect((response.body as any).error).toBe('Payment Required');
    expect((response.body as any).requirements).toEqual(BASE_REQUIREMENTS);
  });

  it('X-Payment-Required header contains amount and currency', () => {
    const response = buildX402Response(BASE_REQUIREMENTS);
    const header = response.headers['X-Payment-Required'];
    expect(header).toContain('50');
    expect(header).toContain('RLUSD');
  });

  it('body contains required tier in requirements', () => {
    const requirements: X402Requirements = {
      ...BASE_REQUIREMENTS,
      requiredTier: 'GOLD',
      amount: '1000',
    };
    const response = buildX402Response(requirements);
    expect((response.body as any).requirements.requiredTier).toBe('GOLD');
    expect((response.body as any).requirements.amount).toBe('1000');
  });
});
