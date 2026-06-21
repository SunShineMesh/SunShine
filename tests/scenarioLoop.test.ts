// Tests for the v3 case-based agent loop in scenario.ts.
//
// The full scenario needs a live XRPL client + DeepSeek, so it can't run in a
// unit test. But the CORE rule — "a payment case settles only if every gate
// passes; any failing gate HALTS the case" — is extracted as the pure function
// casePasses(), which we test exhaustively here. We also guard the structural
// invariants of the rewritten scenario by inspecting the source (same approach
// as brain.test.ts).

import { describe, it, expect } from 'vitest';
import { casePasses, caseVerdict, budgetCheck, commitBudget } from '../src/agent/scenario.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarioSrc = readFileSync(join(__dirname, '../src/agent/scenario.ts'), 'utf8');

describe('casePasses — the stop-on-denial gate rule', () => {
  it('PROCEEDS only when AML passes, agent says PROCEED, and budget is OK', () => {
    expect(casePasses({ amlAction: 'PASS', decision: 'PROCEED', budgetOk: true })).toBe(true);
  });

  it('REVIEW (not DENY) on AML still allows settlement when the other gates pass', () => {
    expect(casePasses({ amlAction: 'REVIEW', decision: 'PROCEED', budgetOk: true })).toBe(true);
  });

  it('HALTS when the counterparty is AML-denied (D6 hard gate)', () => {
    expect(casePasses({ amlAction: 'DENY', decision: 'PROCEED', budgetOk: true })).toBe(false);
  });

  it("HALTS when the agent's own risk verdict is HOLD", () => {
    expect(casePasses({ amlAction: 'PASS', decision: 'HOLD', budgetOk: true })).toBe(false);
  });

  it('HALTS when the payment exceeds the delegation budget', () => {
    expect(casePasses({ amlAction: 'PASS', decision: 'PROCEED', budgetOk: false })).toBe(false);
  });

  it('HALTS when more than one gate fails', () => {
    expect(casePasses({ amlAction: 'DENY', decision: 'HOLD', budgetOk: false })).toBe(false);
  });

  it('a single failing gate is enough to halt — full truth table', () => {
    const aml: Array<'PASS' | 'REVIEW' | 'DENY'> = ['PASS', 'REVIEW', 'DENY'];
    const dec: Array<'PROCEED' | 'HOLD'> = ['PROCEED', 'HOLD'];
    const bud = [true, false];
    for (const a of aml) for (const d of dec) for (const b of bud) {
      const expected = a !== 'DENY' && d === 'PROCEED' && b === true;
      expect(casePasses({ amlAction: a, decision: d, budgetOk: b })).toBe(expected);
    }
  });
});

describe('caseVerdict — a case header reflects the ACTUAL settlement outcome', () => {
  it('APPROVED only when the case proceeded AND the on-ledger gate released funds', () => {
    expect(caseVerdict(true, true)).toBe('APPROVED');
  });

  it('DENIED when soft gates passed but the on-ledger gate refused release', () => {
    // The bug this guards: header said APPROVED off proceedA alone while the
    // settlement card showed DENIED because gateCheck() refused the release.
    expect(caseVerdict(true, false)).toBe('DENIED');
  });

  it('DENIED when a soft gate halted the case before any on-ledger gate ran', () => {
    expect(caseVerdict(false, undefined)).toBe('DENIED');
  });

  it('DENIED when the case proceeded but no gate result was produced (e.g. credential unavailable)', () => {
    expect(caseVerdict(true, undefined)).toBe('DENIED');
  });

  it('DENIED if (defensively) a soft gate denied yet a gate result leaked through', () => {
    expect(caseVerdict(false, true)).toBe('DENIED');
  });
});

describe('budget accounting — checking is pure; the budget is spent only on settlement', () => {
  it('budgetCheck allows a draw within the cap WITHOUT consuming the budget', () => {
    const budget = { allocated: '100' };
    const r = budgetCheck(budget, '40', '150');
    expect(r.ok).toBe(true);
    // The bug this guards: the old drawBudget mutated allocated at check time, so
    // a case that later HALTED still consumed the fleet budget. Checking is pure now.
    expect(budget.allocated).toBe('100');
  });

  it('budgetCheck denies a draw that would exceed the cap, and still does not mutate', () => {
    const budget = { allocated: '110' };
    const r = budgetCheck(budget, '500', '150');
    expect(r.ok).toBe(false);
    expect(budget.allocated).toBe('110');
  });

  it('commitBudget is the ONLY thing that spends the budget', () => {
    const budget = { allocated: '110' };
    commitBudget(budget, '30');
    expect(budget.allocated).toBe('140');
  });

  it('the happy-path sequence ($50 + $60, then $30) accumulates to $140 only via commits', () => {
    const budget = { allocated: '0' };
    expect(budgetCheck(budget, '50', '150').ok).toBe(true);
    commitBudget(budget, '50');
    expect(budgetCheck(budget, '60', '150').ok).toBe(true);
    commitBudget(budget, '60');
    expect(budget.allocated).toBe('110'); // what Case E sees → $500 projected $610 > $150 → DENIED
    expect(budgetCheck(budget, '500', '150').ok).toBe(false);
    commitBudget(budget, '30');
    expect(budget.allocated).toBe('140');
  });
});

describe('scenario v3 — case-based structure (source guards)', () => {
  it('emits case dividers (caseHeader) so each payment is bounded to one counterparty', () => {
    expect(scenarioSrc).toMatch(/caseHeader/);
    // The five payment cases + a governance section each get a header.
    for (const id of ['caseA', 'caseB', 'caseC', 'caseD', 'caseE', 'caseGov']) {
      expect(scenarioSrc).toContain(`'${id}'`);
    }
  });

  it('settlement is gated on casePasses (the stop-on-denial rule)', () => {
    expect(scenarioSrc).toMatch(/const proceedA = casePasses\(/);
    expect(scenarioSrc).toMatch(/const proceedB = casePasses\(/);
  });

  it('denied cases are marked halted: true so the UI shows the process stopped', () => {
    expect(scenarioSrc).toMatch(/halted:\s*true/);
  });

  it('reasoning is uncapped — uses CONFIG.deepseek.maxTokens, not a hardcoded small cap', () => {
    expect(scenarioSrc).toMatch(/CONFIG\.deepseek\.maxTokens/);
    // No leftover small literal caps (700/900) from the old scenario.
    expect(scenarioSrc).not.toMatch(/maxTokens:\s*700\b/);
    expect(scenarioSrc).not.toMatch(/maxTokens:\s*900\b/);
  });

  it('surfaces per-decision reasoning on settlement steps (reasoning: assess*.reasoning)', () => {
    expect(scenarioSrc).toMatch(/reasoning:\s*assessA\.reasoning/);
    expect(scenarioSrc).toMatch(/reasoning:\s*assessB\.reasoning/);
  });

  it('the per-case budget gate enforces the advertised FLEET budget, not the big KYB cap', () => {
    expect(scenarioSrc).toMatch(/budgetCheck\(budget,\s*amountA,\s*fleetBudget\)/);
    expect(scenarioSrc).toMatch(/budgetCheck\(budget,\s*amountB,\s*fleetBudget\)/);
    // the old commit-on-check helper that drew against maxDelegatedSpend is gone
    expect(scenarioSrc).not.toMatch(/drawBudget/);
  });

  it('the budget is spent (committed) only after on-ledger settlement, via commitBudget', () => {
    expect(scenarioSrc).toMatch(/commitBudget\(budget,\s*amountA\)/);
    expect(scenarioSrc).toMatch(/commitBudget\(budget,\s*amountB\)/);
  });
});
