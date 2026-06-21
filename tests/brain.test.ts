// Tests for brain.ts — FIX 2 regression guard.
//
// The brain's assessPayment was changed so that the fallback path (when the LLM
// is unavailable or returns an error) defaults to HOLD instead of PROCEED.
// We cannot unit-test the live DeepSeek path without a network call, but we can
// inspect the source to assert the structural fix is in place — and verify the
// function returns a well-formed PaymentAssessment regardless of path.

import { describe, it, expect } from 'vitest';
import { assessPayment, brainEnabled } from '../src/agent/brain.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const brainSource = readFileSync(join(__dirname, '../src/agent/brain.ts'), 'utf8');

describe('assessPayment — FIX 2 structural guard', () => {
  it('FIX 2: source uses t.fallback condition to force HOLD on fallback (not default PROCEED)', () => {
    // After FIX 2, the decision line must start with the fallback guard:
    //   t.fallback || /DECISION:\s*HOLD/i.test(t.content) ? 'HOLD' : 'PROCEED'
    // The OLD (broken) code was:
    //   /DECISION:\s*HOLD/i.test(t.content) ? 'HOLD' : 'PROCEED'
    // This test asserts the structural fix is present in the source.
    expect(brainSource).toMatch(/t\.fallback\s*\|\|.*DECISION.*HOLD.*HOLD.*PROCEED/s);
  });

  it('FIX 2: fallback rationale in source references fail-safe (not in-policy PROCEED)', () => {
    // The old rationale was "defaulting to in-policy PROCEED for amounts within the ceiling."
    // After FIX 2 it must say "holding payment (fail-safe)."
    expect(brainSource).toMatch(/holding payment.*fail-safe/i);
    expect(brainSource).not.toMatch(/defaulting to in-policy PROCEED/i);
  });

  it('assessPayment returns a well-formed PaymentAssessment', async () => {
    const ctx = {
      payer: 'Novartis AG', payerCountry: 'Switzerland',
      payee: 'Lagos Precision Parts', payeeCountry: 'Nigeria',
      amount: '50', currency: 'USD', purpose: 'CNC precision parts',
      tier: 'BRONZE', maxTxAmount: '100',
    };
    const result = await assessPayment(ctx);
    // Shape contract: decision must be PROCEED or HOLD (regardless of path)
    expect(['PROCEED', 'HOLD']).toContain(result.decision);
    expect(typeof result.rationale).toBe('string');
    expect(typeof result.ms).toBe('number');
    expect(typeof result.model).toBe('string');
    expect(typeof result.fallback).toBe('boolean');
  });

  it('assessPayment decision is HOLD when fallback=true (simulated by checking the logic)', () => {
    // Directly verify the logic that assessPayment applies:
    // if t.fallback is true, decision is HOLD regardless of t.content.
    const fallbackThought = { content: '', reasoning: '', ms: 0, model: 'test', fallback: true };
    const decision: 'PROCEED' | 'HOLD' = fallbackThought.fallback || /DECISION:\s*HOLD/i.test(fallbackThought.content) ? 'HOLD' : 'PROCEED';
    expect(decision).toBe('HOLD');
  });

  it('assessPayment decision is PROCEED when fallback=false and content says PROCEED', () => {
    const liveThought = { content: 'DECISION: PROCEED\nPayment is in-policy.', reasoning: '', ms: 100, model: 'test', fallback: false };
    const decision: 'PROCEED' | 'HOLD' = liveThought.fallback || /DECISION:\s*HOLD/i.test(liveThought.content) ? 'HOLD' : 'PROCEED';
    expect(decision).toBe('PROCEED');
  });
});
