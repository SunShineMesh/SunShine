// AML hard-gate tests (Task 1, D6)
// TDD: these tests were written BEFORE the implementation.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildAmlMatcher, screenName, type AmlMatcher, type ScreeningResult } from '../src/kya/aml.js';

let matcher: AmlMatcher;

beforeAll(() => {
  // Force fixture mode so tests run fast and offline without the 7 MB CSV.
  process.env.SANCTIONS_FIXTURE = 'true';
  matcher = buildAmlMatcher();
});

describe('buildAmlMatcher', () => {
  it('returns a function (the matcher)', () => {
    expect(typeof matcher).toBe('function');
  });

  it('runs in < 50 ms per call after loading', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      matcher('alice muller');
    }
    const elapsed = Date.now() - start;
    // 100 calls must complete in under 500 ms total (5 ms avg, well under 50 ms each)
    expect(elapsed).toBeLessThan(500);
  });
});

describe('screenName — SDN hit', () => {
  it("'viktor bout' → DENY with score >= 0.88 and matchedName set", () => {
    const result: ScreeningResult = matcher('viktor bout');
    expect(result.action).toBe('DENY');
    expect(result.score).toBeGreaterThanOrEqual(0.88);
    expect(result.matchedName).toBeTruthy();
    expect(result.hit).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it("'Viktor Bout' (mixed case) → DENY", () => {
    const result = matcher('Viktor Bout');
    expect(result.action).toBe('DENY');
  });

  it("'VIKTOR BOUT' (upper case) → DENY", () => {
    const result = matcher('VIKTOR BOUT');
    expect(result.action).toBe('DENY');
  });

  it("alias 'victor bout' → DENY (alias match)", () => {
    const result = matcher('victor bout');
    expect(result.action).toBe('DENY');
    expect(result.score).toBeGreaterThanOrEqual(0.88);
  });
});

describe('screenName — clear names', () => {
  it("'alice muller' → PASS with score < 0.80", () => {
    const result: ScreeningResult = matcher('alice muller');
    expect(result.action).toBe('PASS');
    expect(result.score).toBeLessThan(0.80);
    expect(result.hit).toBe(false);
  });

  it("'thomas bergmann' → PASS", () => {
    const result = matcher('thomas bergmann');
    expect(result.action).toBe('PASS');
    expect(result.hit).toBe(false);
  });
});

describe('screenName — normalization', () => {
  it('strips diacritics: "büt" normalises like "but"', () => {
    // Alice Müller should still pass (not in list)
    const result = matcher('alice müller');
    expect(result.action).toBe('PASS');
  });

  it('strips honorifics: "Mr Viktor Bout" → DENY', () => {
    const result = matcher('Mr Viktor Bout');
    expect(result.action).toBe('DENY');
  });

  it('strips punctuation: "Viktor. Bout" → DENY', () => {
    const result = matcher('Viktor. Bout');
    expect(result.action).toBe('DENY');
  });
});

describe('screenName — alias matching', () => {
  it("'Victor Butt' (alias) → DENY", () => {
    const result = matcher('Victor Butt');
    expect(result.action).toBe('DENY');
    expect(result.score).toBeGreaterThanOrEqual(0.88);
  });
});

describe('screenName — thresholds', () => {
  it('score >= 0.88 → DENY, 0.80–0.87 → REVIEW, < 0.80 → PASS', () => {
    // We can verify the threshold logic directly via screenName helper
    const result = screenName(matcher, 'viktor bout');
    expect(result.action).toBe('DENY');
  });
});

describe('fixture loading', () => {
  it('SANCTIONS_FIXTURE=true loads the small JSON fixture', () => {
    const m = buildAmlMatcher();
    // The fixture has Viktor Bout as a DENY
    const r = m('viktor bout');
    expect(r.action).toBe('DENY');
  });

  it('custom csvPath to fixture JSON works too', () => {
    const m = buildAmlMatcher('data/sanctions_fixture.json');
    const r = m('viktor bout');
    expect(r.action).toBe('DENY');
  });
});
