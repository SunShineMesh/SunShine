// TASK 7 — World ID IDKit v4 integration (D2) backend tests
//
// TDD-first: all tests must FAIL before the implementation exists.
// After implementation all tests must PASS.

import { describe, it, expect, vi } from 'vitest';
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

  it('extracts nullifier from v3 legacy result (top-level nullifier_hash, no responses[0].nullifier)', () => {
    // v3 legacy bridge shape: nullifier_hash lives at the TOP LEVEL,
    // NOT inside responses[0].nullifier.  This exercises the fallback
    // branch in extractNullifier (lines 66-68 of backend.ts) that the
    // v4 path never reaches.
    const idkitResultV3Legacy = {
      protocol_version: '3.0',
      nullifier_hash: '0xBEEF5678',
      merkle_root: '0x000',
      proof: 'abc...',
      credential_type: 'orb',
      action: 'meshcredit-agent-verify',
      // NOTE: no `responses` array — this is the classic v3 flat shape
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
//
// LIMITATION: @worldcoin/idkit-core/signing requires the actual World ID SDK
// runtime (WASM / secp256k1 bindings) which is not available in the vitest
// Node environment. The handler therefore falls back to { fallback: true } even
// when a key is set.  This test verifies:
//   (a) the handler is reached (i.e. the key env-var IS read and does NOT
//       cause the "key absent" early-return — meaning rpSignatureHandler
//       enters the signing try-block), AND
//   (b) the graceful-error branch fires when signRequest throws in test env,
//       producing a fallback response whose `message` mentions the failure
//       (not the generic "wiring shown, proof pending" absent-key message).
//
// A full integration test of the signing path requires the real SDK runtime
// and must be run in an environment where the WASM bundle can be loaded.

describe('rpSignatureHandler with signing key present', () => {
  it('enters the signing path (not the absent-key early return) and responds when key is set', async () => {
    // Use a valid 32-byte (64-hex) ECDSA private key
    const testKey = '0x' + 'a'.repeat(64);
    process.env.WORLDID_RP_SIGNING_KEY = testKey;
    process.env.WORLDID_ACTION = 'meshcredit-agent-verify';

    const { rpSignatureHandler } = await import('../src/worldid/backend.js');

    const req = { body: {} } as any;
    const jsonSpy = vi.fn();
    const res = { json: jsonSpy, status: vi.fn().mockReturnValue({ json: jsonSpy }) } as any;

    await rpSignatureHandler(req, res);

    const call = jsonSpy.mock.calls[0]?.[0] as any;
    // The handler MUST have responded (json was called exactly once)
    expect(jsonSpy).toHaveBeenCalledTimes(1);

    if (call?.fallback) {
      // SDK unavailable in test env: the graceful-error branch fired.
      // Confirm this is the *error* fallback (has a descriptive message),
      // NOT the absent-key early-return (which says "wiring shown, proof pending").
      // The absent-key path returns exactly "wiring shown, proof pending";
      // the signing-path graceful-error branch produces a different message
      // (e.g. "signing unavailable: ..."). If the key was properly read and
      // the signing path entered, the message MUST differ.
      expect(call.message).not.toBe('wiring shown, proof pending');
    } else {
      // SDK was available: real signature returned
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

// ─── 6. verifyProofHandler — nullifier replay prevention wired ───────────────

describe('verifyProofHandler nullifier replay prevention', () => {
  it('persists the nullifier to the module-level store and rejects replays', async () => {
    // Import the module-level store instance to reset it between test runs.
    const mod = await import('../src/worldid/backend.js');
    // nullifierStore must be exported so tests (and ops tooling) can inspect it.
    expect(mod.nullifierStore).toBeDefined();

    // Reset the in-process store to a known-empty state.
    // We do this by clearing the store's internal memory map directly.
    // The exported instance uses ':memory:' path because WORLDID_NULLIFIER_STORE
    // is set to ':memory:' in vitest.config.ts, so state is fully in-process
    // and isolated across test runs and CI shards.
    const store: NullifierStore = mod.nullifierStore as NullifierStore;

    // Provide a unique nullifier for this test run so it doesn't collide
    // with other tests.
    const uniqueNullifier = '0xREPLAY_TEST_' + Date.now();

    // Pre-seed the store with this nullifier to simulate a prior verification.
    store.add(uniqueNullifier, { action: 'meshcredit-agent-verify', storedAt: Date.now() });

    // Now simulate verifyProofHandler seeing the same nullifier again.
    // Set up env to trigger the verification path.
    const origRpId = process.env.WORLDID_RP_ID;
    process.env.WORLDID_RP_ID = 'rp_test';

    // Mock global fetch so no real HTTP call is made.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        responses: [{ nullifier: uniqueNullifier, identifier: 'proof_of_human' }],
      }),
    });
    const origFetch = (global as any).fetch;
    (global as any).fetch = mockFetch;

    const { verifyProofHandler } = mod;
    const req = {
      body: {
        responses: [{ nullifier: uniqueNullifier, identifier: 'proof_of_human' }],
      },
    } as any;
    const jsonSpy = vi.fn();
    const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    const res = { json: jsonSpy, status: statusSpy } as any;

    await verifyProofHandler(req, res);

    // The handler must reject with a 409 or an error body mentioning replay.
    const statusCall = statusSpy.mock.calls[0]?.[0];
    const jsonCall = jsonSpy.mock.calls[0]?.[0] as any;

    // Either a 409 status was set, or the json body contains an error about replay.
    const isReplayRejected =
      statusCall === 409 ||
      (typeof jsonCall?.error === 'string' && /replay/i.test(jsonCall.error)) ||
      (typeof jsonCall?.message === 'string' && /replay/i.test(jsonCall.message));

    expect(isReplayRejected).toBe(true);

    // Restore
    (global as any).fetch = origFetch;
    if (origRpId !== undefined) process.env.WORLDID_RP_ID = origRpId;
    else delete process.env.WORLDID_RP_ID;
  });
});
