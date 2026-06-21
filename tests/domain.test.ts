// Unit tests for the XLS-80 Permissioned Domain access-control layer.
// These cover pure logic only: tier ranking, tier comparison, AcceptedCredentials
// structure, and credential-type hex. No network I/O.
import { describe, it, expect } from 'vitest';
import { tierRank, compareTier, buildAcceptedCredentials, withinLimit } from '../src/xrpl/domain.js';
import { CRED_TYPE, toHex } from '../src/xrpl/codec.js';
import type { Tier } from '../src/kya/scorecard.js';

// ── withinLimit ───────────────────────────────────────────────────────────────

describe('withinLimit', () => {
  it('allows amount equal to maxTxAmount', () => { expect(withinLimit('500', '500')).toBe(true); });
  it('allows amount below maxTxAmount', () => { expect(withinLimit('500', '100')).toBe(true); });
  it('denies amount above maxTxAmount (decorative-limit guard)', () => { expect(withinLimit('25', '100')).toBe(false); });
});

// ── tierRank ────────────────────────────────────────────────────────────────

describe('tierRank', () => {
  it('DENIED is 0', () => {
    expect(tierRank('DENIED')).toBe(0);
  });
  it('TIER-1 is 1', () => {
    expect(tierRank('TIER-1')).toBe(1);
  });
  it('TIER-2 is 2', () => {
    expect(tierRank('TIER-2')).toBe(2);
  });
  it('TIER-3 is 3', () => {
    expect(tierRank('TIER-3')).toBe(3);
  });
  it('TIER-4 is 4', () => {
    expect(tierRank('TIER-4')).toBe(4);
  });
});

// ── compareTier ─────────────────────────────────────────────────────────────

describe('compareTier', () => {
  const allTiers: Tier[] = ['DENIED', 'TIER-1', 'TIER-2', 'TIER-3', 'TIER-4'];

  it('DENIED < TIER-1 at all thresholds', () => {
    expect(compareTier('DENIED', 'TIER-1')).toBe(false);
    expect(compareTier('DENIED', 'TIER-2')).toBe(false);
    expect(compareTier('DENIED', 'TIER-3')).toBe(false);
    expect(compareTier('DENIED', 'TIER-4')).toBe(false);
  });

  it('DENIED meets DENIED threshold', () => {
    // a DENIED agent meeting a DENIED requirement is technically >=, but in
    // practice DENIED agents are never issued credentials, so this is an edge
    // case we explicitly document as allowed by the pure math (rank 0 >= 0)
    expect(compareTier('DENIED', 'DENIED')).toBe(true);
  });

  it('TIER-1 meets TIER-1 and below, but not TIER-2+', () => {
    expect(compareTier('TIER-1', 'DENIED')).toBe(true);
    expect(compareTier('TIER-1', 'TIER-1')).toBe(true);
    expect(compareTier('TIER-1', 'TIER-2')).toBe(false);
    expect(compareTier('TIER-1', 'TIER-3')).toBe(false);
    expect(compareTier('TIER-1', 'TIER-4')).toBe(false);
  });

  it('TIER-2 meets TIER-2 and below, but not TIER-3+', () => {
    expect(compareTier('TIER-2', 'DENIED')).toBe(true);
    expect(compareTier('TIER-2', 'TIER-1')).toBe(true);
    expect(compareTier('TIER-2', 'TIER-2')).toBe(true);
    expect(compareTier('TIER-2', 'TIER-3')).toBe(false);
    expect(compareTier('TIER-2', 'TIER-4')).toBe(false);
  });

  it('TIER-3 meets TIER-3 and below, but not TIER-4', () => {
    expect(compareTier('TIER-3', 'DENIED')).toBe(true);
    expect(compareTier('TIER-3', 'TIER-1')).toBe(true);
    expect(compareTier('TIER-3', 'TIER-2')).toBe(true);
    expect(compareTier('TIER-3', 'TIER-3')).toBe(true);
    expect(compareTier('TIER-3', 'TIER-4')).toBe(false);
  });

  it('TIER-4 meets every threshold', () => {
    for (const t of allTiers) {
      expect(compareTier('TIER-4', t)).toBe(true);
    }
  });

  it('is strictly monotonic: each tier satisfies all lower requirements', () => {
    // for every agent tier a and every required tier r where rank(a) >= rank(r),
    // compareTier returns true; otherwise false
    for (const agentTier of allTiers) {
      for (const requiredTier of allTiers) {
        const expected = tierRank(agentTier) >= tierRank(requiredTier);
        expect(compareTier(agentTier, requiredTier)).toBe(expected);
      }
    }
  });
});

// ── v3 PassportTier support in tierRank / compareTier ────────────────────────
// Regression for Bug 1 / Bug 3 fix: gateCheck casts decoded v3 credential tiers
// (BRONZE/SILVER/GOLD/PLATINUM) using tierRank(). Before the fix, those strings
// fell through the switch and returned undefined, making every v3 credential fail
// the gateCheck — which caused an immediate EscrowCancel (tecNO_PERMISSION crash).

describe('tierRank — v3 PassportTier support', () => {
  it('BRONZE maps to rank 1 (same as TIER-1)', () => {
    expect(tierRank('BRONZE')).toBe(1);
  });
  it('SILVER maps to rank 2 (same as TIER-2)', () => {
    expect(tierRank('SILVER')).toBe(2);
  });
  it('GOLD maps to rank 3 (same as TIER-3)', () => {
    expect(tierRank('GOLD')).toBe(3);
  });
  it('PLATINUM maps to rank 4 (same as TIER-4)', () => {
    expect(tierRank('PLATINUM')).toBe(4);
  });
  it('unknown string maps to rank 0 (no access)', () => {
    expect(tierRank('UNKNOWN_TIER')).toBe(0);
  });
});

describe('compareTier — v3 PassportTier meets v1/v2 Tier requirements', () => {
  it('BRONZE satisfies TIER-1 gate', () => {
    expect(compareTier('BRONZE', 'TIER-1')).toBe(true);
  });
  it('BRONZE does not satisfy TIER-2 gate', () => {
    expect(compareTier('BRONZE', 'TIER-2')).toBe(false);
  });
  it('GOLD satisfies TIER-1, TIER-2, and TIER-3 gates', () => {
    expect(compareTier('GOLD', 'TIER-1')).toBe(true);
    expect(compareTier('GOLD', 'TIER-2')).toBe(true);
    expect(compareTier('GOLD', 'TIER-3')).toBe(true);
  });
  it('DENIED (v3) does not satisfy TIER-1 gate', () => {
    expect(compareTier('DENIED', 'TIER-1')).toBe(false);
  });
});

// ── buildAcceptedCredentials ────────────────────────────────────────────────

describe('buildAcceptedCredentials', () => {
  const issuer = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

  it('returns an array with exactly one AuthorizeCredential object', () => {
    const creds = buildAcceptedCredentials(issuer);
    expect(Array.isArray(creds)).toBe(true);
    expect(creds).toHaveLength(1);
  });

  it('Credential.Issuer matches the supplied issuer address', () => {
    const creds = buildAcceptedCredentials(issuer);
    expect(creds[0].Credential.Issuer).toBe(issuer);
  });

  it('Credential.CredentialType is the hex of agent_trust_v1', () => {
    const creds = buildAcceptedCredentials(issuer);
    expect(creds[0].Credential.CredentialType).toBe(CRED_TYPE);
  });

  it('CRED_TYPE hex encodes to agent_trust_v1 (cross-check)', () => {
    // verify the hex constant used by codec.ts is correct
    expect(CRED_TYPE).toBe(toHex('agent_trust_v1'));
  });

  it('shape is AuthorizeCredential[] as per xrpl.js v5 typings', () => {
    const creds = buildAcceptedCredentials(issuer);
    // each element must have exactly the shape { Credential: { Issuer, CredentialType } }
    for (const c of creds) {
      expect(typeof c.Credential).toBe('object');
      expect(typeof c.Credential.Issuer).toBe('string');
      expect(typeof c.Credential.CredentialType).toBe('string');
    }
  });

  it('different issuers produce different credentials', () => {
    const a = buildAcceptedCredentials('rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const b = buildAcceptedCredentials('rBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(a[0].Credential.Issuer).not.toBe(b[0].Credential.Issuer);
    // CredentialType stays the same (same credential type regardless of issuer)
    expect(a[0].Credential.CredentialType).toBe(b[0].Credential.CredentialType);
  });
});
