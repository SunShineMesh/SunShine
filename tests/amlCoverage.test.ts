// AML false-positive regression — token-coverage gate.
//
// The matcher scored similarity by running Jaro-Winkler on the CONCATENATION of
// sorted tokens. That rewards raw character/prefix overlap regardless of whether
// the tokens actually align, so legitimate multi-word company names over-matched
// short/junk SDN strings:
//   - "Taipei Tech Components" → DENY (0.90) against junk "t component"
//   - "Novartis AG"            → REVIEW (0.86) against "karpis ag" (our own operator!)
// Over-blocking legitimate businesses is the central real-world AML failure mode,
// and it broke the demo (the headline Taipei case flipped to DENIED).
//
// The fix multiplies the base similarity by a token-coverage factor: the best of
// (fraction of query tokens with a strong partner in the SDN name) and (fraction
// of SDN tokens with a strong partner in the query). A genuine match — full name,
// alias, or a sanctioned name padded with extra words — keeps coverage 1.0 in at
// least one direction, so its score is unchanged. A partial/junk overlap is
// downgraded. The factor is ≤ 1, so it can only REDUCE a score: it can never turn
// a real PASS into a hit, and never introduces a false negative for a fully-covered
// match. These cases reproduce the real CSV false positives deterministically.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildAmlMatcher, type AmlMatcher } from '../src/kya/aml.js';

let matcher: AmlMatcher;

beforeAll(() => {
  matcher = buildAmlMatcher('data/aml_coverage_fixture.json');
});

describe('token-coverage gate — legitimate companies are not over-blocked', () => {
  it("'Taipei Tech Components' → PASS (not DENY against the 'Component T' decoy)", () => {
    const r = matcher('Taipei Tech Components');
    expect(r.action).toBe('PASS');
    expect(r.hit).toBe(false);
    expect(r.score).toBeLessThan(0.80);
  });

  it("'Novartis AG' (the operator) → PASS (not REVIEW against the 'Karpis AG' decoy)", () => {
    const r = matcher('Novartis AG');
    expect(r.action).toBe('PASS');
    expect(r.score).toBeLessThan(0.80);
  });
});

describe('token-coverage gate — genuine matches are preserved', () => {
  it("exact sanctioned name still DENIES at full strength", () => {
    const r = matcher('Star Dragon Corporation Limited');
    expect(r.action).toBe('DENY');
    expect(r.score).toBeGreaterThanOrEqual(0.88);
    expect(r.hit).toBe(true);
  });

  it("a sanctioned name PADDED with extra words still hits (REVIEW or DENY, never PASS)", () => {
    // "Star Dragon Corporation Limited Holdings" fully covers the SDN name in the
    // SDN→query direction (coverage 1.0), so it must remain a hit, not slip to PASS.
    const r = matcher('Star Dragon Corporation Limited Holdings');
    expect(r.action).not.toBe('PASS');
    expect(r.score).toBeGreaterThanOrEqual(0.80);
  });
});
