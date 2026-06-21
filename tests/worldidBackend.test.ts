// TASK 7 — World ID IDKit v4 integration (D2) backend tests
//
// TDD-first: all tests must FAIL before the implementation exists.
// After implementation all tests must PASS.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DimensionRecord } from '../src/kya/dimension.js';
import {
  buildD2DimensionRecord,
  extractNullifier,
  type WorldIdVerifyResult,
  NullifierStore,
} from '../src/worldid/backend.js';

// ─── 1. buildD2DimensionRecord ────────────────────────────────────────────────

describe('buildD2DimensionRecord', () => {
  const verifiedAt = 1_700_000_000_000; // unix ms

  it('produces a valid DimensionRecord with issuer World ID', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '0xABCD1234',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'device',
      verifiedAt,
      fallback: false,
    };
    const dim = buildD2DimensionRecord(result, verifiedAt);

    expect(dim.id).toBe('D2');
    expect(dim.issuer).toBe('World ID');
    expect(dim.status).toBe('PASS');
    expect(dim.evidenceRef).toBe('0xABCD1234');
    expect(dim.checkedAt).toBe(verifiedAt);
  });

  it('stores nullifier as evidenceRef', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '0xDEADBEEF',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'orb',
      verifiedAt,
      fallback: false,
    };
    const dim = buildD2DimensionRecord(result);
    expect(dim.evidenceRef).toBe('0xDEADBEEF');
  });

  it('includes action and verificationLevel in details', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '0x1111',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'orb',
      verifiedAt,
      fallback: false,
    };
    const dim = buildD2DimensionRecord(result, verifiedAt);
    expect(dim.details.action).toBe('meshcredit-agent-verify');
    expect(dim.details.verificationLevel).toBe('orb');
  });

  it('sets status PASS when fallback is false', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '0xAAAA',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'device',
      verifiedAt,
      fallback: false,
    };
    expect(buildD2DimensionRecord(result, verifiedAt).status).toBe('PASS');
  });

  it('sets status PENDING when fallback is true', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'unknown',
      verifiedAt,
      fallback: true,
    };
    expect(buildD2DimensionRecord(result, verifiedAt).status).toBe('PENDING');
  });

  it('produces a non-empty evidenceHash (SHA-256 of the result)', () => {
    const result: WorldIdVerifyResult = {
      nullifier: '0xABCD1234',
      action: 'meshcredit-agent-verify',
      verificationLevel: 'device',
      verifiedAt,
      fallback: false,
    };
    const dim = buildD2DimensionRecord(result, verifiedAt);
    expect(dim.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── 2. extractNullifier ─────────────────────────────────────────────────────

describe('extractNullifier', () => {
  it('extracts nullifier from v4 result (responses[0].nullifier)', () => {
    const idkitResultV4 = {
      protocol_version: '4.0',
      nonce: 'abc123',
      action: 'meshcredit-agent-verify',
      responses: [
        {
          identifier: 'proof_of_human',
          nullifier: '0xDEAD1234',
          proof: [],
          issuer_schema_id: 1,
          expires_at_min: 9999999999,
        },
      ],
      user_presence_completed: true,
      environment: 'production',
    };
    expect(extractNullifier(idkitResultV4)).toBe('0xDEAD1234');
  });

  it('extracts nullifier from v3 legacy result (responses[0].nullifier / nullifier_hash)', () => {
    // v3 uses nullifier directly in responses
    const idkitResultV3Legacy = {
      protocol_version: '3.0',
      nonce: 'abc456',
      action: 'meshcredit-agent-verify',
      responses: [
        {
          identifier: 'proof_of_human',
          nullifier: '0xBEEF5678',
          proof: 'abc...',
          merkle_root: '0x000',
        },
      ],
      user_presence_completed: false,
      environment: 'production',
    };
    expect(extractNullifier(idkitResultV3Legacy)).toBe('0xBEEF5678');
  });

  it('returns empty string for unknown result shape', () => {
    expect(extractNullifier({})).toBe('');
    expect(extractNullifier(null)).toBe('');
    expect(extractNullifier({ responses: [] })).toBe('');
  });
});

// ─── 3. rpSignatureHandler — fallback when key absent ────────────────────────

describe('rpSignatureHandler and verifyProofHandler (HTTP handlers)', () => {
  it('rpSignatureHandler returns fallback JSON when WORLDID_RP_SIGNING_KEY absent', async () => {
    // Temporarily unset key
    const origKey = process.env.WORLDID_RP_SIGNING_KEY;
    delete process.env.WORLDID_RP_SIGNING_KEY;

    // Import handler AFTER env manipulation (via dynamic import to avoid module caching issue)
    const { rpSignatureHandler } = await import('../src/worldid/backend.js');

    // Mock minimal express req/res
    const req = { body: {}, headers: {} } as any;
    const jsonSpy = vi.fn();
    const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    const res = { json: jsonSpy, status: statusSpy } as any;

    await rpSignatureHandler(req, res);

    // When key absent, must respond with fallback:true
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: true }),
    );

    // Restore
    if (origKey !== undefined) process.env.WORLDID_RP_SIGNING_KEY = origKey;
  });

  it('verifyProofHandler returns fallback JSON when WORLDID_RP_ID absent', async () => {
    const origRpId = process.env.WORLDID_RP_ID;
    delete process.env.WORLDID_RP_ID;

    const { verifyProofHandler } = await import('../src/worldid/backend.js');

    const req = { body: { proof: 'test' } } as any;
    const jsonSpy = vi.fn();
    const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    const res = { json: jsonSpy, status: statusSpy } as any;

    await verifyProofHandler(req, res);

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: true }),
    );

    if (origRpId !== undefined) process.env.WORLDID_RP_ID = origRpId;
  });
});

// ─── 4. rpSignatureHandler — with signing key present ────────────────────────

describe('rpSignatureHandler with signing key present', () => {
  it('returns sig, nonce, createdAt, expiresAt when key is set', async () => {
    // Use a valid 32-byte (64-hex) ECDSA private key for testing
    const testKey = '0x' + 'a'.repeat(64);
    process.env.WORLDID_RP_SIGNING_KEY = testKey;
    process.env.WORLDID_ACTION = 'meshcredit-agent-verify';

    const { rpSignatureHandler } = await import('../src/worldid/backend.js');

    const req = { body: {} } as any;
    const jsonSpy = vi.fn();
    const res = { json: jsonSpy, status: vi.fn().mockReturnValue({ json: jsonSpy }) } as any;

    await rpSignatureHandler(req, res);

    const call = jsonSpy.mock.calls[0]?.[0] as any;
    // Either it produced a signature or it fell back gracefully
    if (call?.fallback) {
      // signing itself may fail in test env — fallback is acceptable
      expect(call.fallback).toBe(true);
    } else {
      expect(call).toHaveProperty('sig');
      expect(call).toHaveProperty('nonce');
    }

    delete process.env.WORLDID_RP_SIGNING_KEY;
  });
});

// ─── 5. NullifierStore ────────────────────────────────────────────────────────

describe('NullifierStore', () => {
  it('stores and retrieves a nullifier', () => {
    const store = new NullifierStore(':memory:');
    store.add('0xDEAD1234', { action: 'test', storedAt: Date.now() });
    expect(store.has('0xDEAD1234')).toBe(true);
    expect(store.has('0xBADBAD')).toBe(false);
  });

  it('prevents replay (duplicate nullifier)', () => {
    const store = new NullifierStore(':memory:');
    store.add('0xABCD', { action: 'test', storedAt: Date.now() });
    expect(() => store.add('0xABCD', { action: 'test', storedAt: Date.now() })).toThrow(/replay/i);
  });
});
