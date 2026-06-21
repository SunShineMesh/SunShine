// TASK 13 — Phase 1.5: x402 gate middleware
// TDD: these tests are written FIRST and must run red before implementation.

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  checkPassportForX402,
  buildX402Response,
  x402Middleware,
  type X402Requirements,
  type X402GateResult,
  type X402CheckParams,
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
      agentTier: 'BRONZE',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(402);
    expect(result.released).toBe(true);
  });

  it('denies when credential is missing', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rNoCredential',
      credentialStatus: 'missing',
      agentTier: 'BRONZE',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('no valid MeshCredit credential');
  });

  it('denies when credential is revoked', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rRevoked',
      credentialStatus: 'revoked',
      agentTier: 'BRONZE',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('no valid MeshCredit credential');
  });

  it('denies when requested amount exceeds tier ceiling', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rValid',
      credentialStatus: 'valid',
      agentTier: 'SILVER',
      tierCeiling: '500',
      requestedAmount: '600',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('amount exceeds tier ceiling');
  });

  it('denies when amount exactly equals ceiling — allowed (boundary inclusive)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rValid',
      credentialStatus: 'valid',
      agentTier: 'SILVER',
      tierCeiling: '500',
      requestedAmount: '500',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(true);
  });

  it('denies when AML result is DENY', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rViktor',
      credentialStatus: 'valid',
      agentTier: 'BRONZE',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'DENY',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('AML screening DENY');
  });

  it('allows when AML result is REVIEW (not a hard block)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rReview',
      credentialStatus: 'valid',
      agentTier: 'BRONZE',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'REVIEW',
      requiredTier: 'BRONZE',
    });
    // REVIEW is not a hard deny in x402 gate (unlike the credential issuance gate)
    expect(result.allowed).toBe(true);
  });

  it('checks AML before tier ceiling (AML denial takes priority)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rViktor',
      credentialStatus: 'valid',
      agentTier: 'BRONZE',
      tierCeiling: '500',
      // Amount over ceiling AND AML DENY — AML should fire first
      requestedAmount: '600',
      amlResult: 'DENY',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('AML screening DENY');
  });

  // ── New: requiredTier enforcement ─────────────────────────────────────────

  it('denies BRONZE agent when requiredTier is GOLD', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rBronzeAgent',
      credentialStatus: 'valid',
      agentTier: 'BRONZE',
      tierCeiling: '100',       // BRONZE ceiling
      requestedAmount: '50',
      amlResult: 'PASS',
      requiredTier: 'GOLD',     // resource requires GOLD
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(402);
    expect(result.reason).toBe('agent tier BRONZE below required tier GOLD');
  });

  it('denies SILVER agent when requiredTier is GOLD', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rSilverAgent',
      credentialStatus: 'valid',
      agentTier: 'SILVER',
      tierCeiling: '500',
      requestedAmount: '200',
      amlResult: 'PASS',
      requiredTier: 'GOLD',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('agent tier SILVER below required tier GOLD');
  });

  it('allows GOLD agent when requiredTier is GOLD', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rGoldAgent',
      credentialStatus: 'valid',
      agentTier: 'GOLD',
      tierCeiling: '2000',
      requestedAmount: '500',
      amlResult: 'PASS',
      requiredTier: 'GOLD',
    });
    expect(result.allowed).toBe(true);
    expect(result.released).toBe(true);
  });

  it('allows PLATINUM agent when requiredTier is GOLD (higher tier passes)', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rPlatAgent',
      credentialStatus: 'valid',
      agentTier: 'PLATINUM',
      tierCeiling: '10000',
      requestedAmount: '500',
      amlResult: 'PASS',
      requiredTier: 'GOLD',
    });
    expect(result.allowed).toBe(true);
    expect(result.released).toBe(true);
  });

  it('tier check runs after credential check — revoked agent denied before tier check', async () => {
    // Revoked agent should be denied by Gate 1 (credential) NOT Gate 4 (tier).
    // Even if requiredTier is BRONZE and agent claims GOLD, revoked wins.
    const result = await checkPassportForX402({
      agentAddr: 'rRevokedGold',
      credentialStatus: 'revoked',
      agentTier: 'GOLD',
      tierCeiling: '2000',
      requestedAmount: '100',
      amlResult: 'PASS',
      requiredTier: 'BRONZE',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no valid MeshCredit credential');
  });

  it('tier check runs after AML check — AML DENY fires before tier mismatch', async () => {
    const result = await checkPassportForX402({
      agentAddr: 'rSanctionedBronze',
      credentialStatus: 'valid',
      agentTier: 'BRONZE',
      tierCeiling: '100',
      requestedAmount: '50',
      amlResult: 'DENY',
      requiredTier: 'GOLD',   // tier mismatch too, but AML fires first
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('AML screening DENY');
  });

  it('backward compat — omitting agentTier and requiredTier skips tier check', async () => {
    // Callers that pass only the original 5 fields must continue to work.
    const params: X402CheckParams = {
      agentAddr: 'rLegacy',
      credentialStatus: 'valid',
      tierCeiling: '500',
      requestedAmount: '50',
      amlResult: 'PASS',
    };
    const result = await checkPassportForX402(params);
    expect(result.allowed).toBe(true);
    expect(result.released).toBe(true);
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

// ── x402Middleware tests ───────────────────────────────────────────────────────

/** Minimal Express-compatible mock helpers */
function makeRes() {
  const calls: { method: string; args: any[] }[] = [];
  const res: any = {
    _calls: calls,
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _json: undefined as any,
    status(code: number) { res._statusCode = code; return res; },
    set(headers: Record<string, string>) { Object.assign(res._headers, headers); return res; },
    json(body: any) { res._json = body; calls.push({ method: 'json', args: [body] }); return res; },
  };
  return res;
}

function makeReq(overrides: Partial<{
  headers: Record<string, string>;
  body: Record<string, string>;
}> = {}) {
  return {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
  } as unknown as Request;
}

describe('x402Middleware', () => {
  const GOLD_REQUIREMENTS: X402Requirements = {
    amount: '500',
    currency: 'RLUSD',
    credentialIssuer: 'MeshCredit',
    requiredTier: 'GOLD',
    paymentAddress: 'rTreasury',
  };

  // fetchCredential stub returning a valid GOLD credential view
  const fetchGoldCredential = async (_addr: string) => ({
    accepted: true,
    tier: 'GOLD' as const,
  });

  // fetchCredential stub returning null (no credential on ledger)
  const fetchNoCredential = async (_addr: string): Promise<null> => null;

  // AML matcher stub — always PASS
  const amlPass = (_name: string) => ({
    hit: false, score: 0, matchedName: '', action: 'PASS' as const,
  });

  // AML matcher stub — always DENY
  const amlDeny = (_name: string) => ({
    hit: true, score: 1, matchedName: 'sanctioned', action: 'DENY' as const,
  });

  it('calls next() when agent has valid GOLD credential for GOLD-required resource', async () => {
    const req = makeReq({ headers: { 'x-agent-addr': 'rGoldAgent' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchGoldCredential, amlPass);
    await middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._json).toBeUndefined();
  });

  it('returns 402 when x-agent-addr header is absent', async () => {
    const req = makeReq();   // no header, no body agentAddr
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchGoldCredential, amlPass);
    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(402);
    expect(res._json?.reason).toContain('no agent address');
  });

  it('reads agentAddr from request body when header is absent', async () => {
    const req = makeReq({ body: { agentAddr: 'rGoldAgent' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchGoldCredential, amlPass);
    await middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 402 with credential denial reason when credential is missing', async () => {
    const req = makeReq({ headers: { 'x-agent-addr': 'rNoCredAgent' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchNoCredential, amlPass);
    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(402);
    expect(res._json?.reason).toBe('no valid MeshCredit credential');
  });

  it('returns 402 when AML matcher returns DENY', async () => {
    const req = makeReq({ headers: { 'x-agent-addr': 'rSanctioned' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchGoldCredential, amlDeny);
    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(402);
    expect(res._json?.reason).toBe('AML screening DENY');
  });

  it('sets X-Payment-Required and X-Payment-Schemes headers on 402 denial', async () => {
    const req = makeReq({ headers: { 'x-agent-addr': 'rNoCredAgent' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchNoCredential, amlPass);
    await middleware(req as any, res as any, next);

    expect(res._headers['X-Payment-Required']).toBeDefined();
    expect(res._headers['X-Payment-Schemes']).toBe('RLUSD/XRPL');
  });

  it('fetchCredential error is treated as missing credential (not a crash)', async () => {
    const fetchThrows = async (_addr: string): Promise<any> => {
      throw new Error('network error');
    };
    const req = makeReq({ headers: { 'x-agent-addr': 'rUnreachable' } });
    const res = makeRes();
    const next = vi.fn();

    const middleware = x402Middleware(GOLD_REQUIREMENTS, fetchThrows, amlPass);
    await middleware(req as any, res as any, next);

    // Should deny (missing) rather than crash
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(402);
  });

  it('marks revoked credential as revoked (accepted=false → status revoked)', async () => {
    // fetchCredential returns a present but un-accepted credential (revoked on ledger).
    const fetchRevoked = async (_addr: string) => ({ accepted: false });
    const req = makeReq({ headers: { 'x-agent-addr': 'rRevoked' } });
    const res = makeRes();
    const next = vi.fn();

    // Use BRONZE requirements so only the revoked status blocks.
    const bronzeReqs: X402Requirements = { ...GOLD_REQUIREMENTS, requiredTier: 'BRONZE' };
    const middleware = x402Middleware(bronzeReqs, fetchRevoked, amlPass);
    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(402);
    expect(res._json?.reason).toBe('no valid MeshCredit credential');
  });
});
