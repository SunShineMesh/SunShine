// TASK 12 — Thick-file setup script tests.
// Per the plan: the test is a sanity-check that 35 settlements produce meaningful
// confidence when fed through computeConfidence(), and that the seed script is
// importable and exports its key symbols.

import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../src/kya/tier.js';

describe('seedScript sanity — thick-file confidence check', () => {
  it('35 settlements / 90-day window / last settlement today → confidence ≥ 60', () => {
    const conf = computeConfidence({
      settlements: 35,
      windowDays: 90,
      daysSinceLastSettlement: 0,
    });
    // Per spec: settlement_score = 0.35, window_score = 1.0, recency_score = 1.0
    // confidence = round((0.35*0.5 + 1.0*0.3 + 1.0*0.2) * 100) = round(0.175 + 0.3 + 0.2)*100 = round(67.5) = 68
    expect(conf).toBeGreaterThanOrEqual(60);
  });

  it('35 settlements / 90-day window shows significantly better confidence than 0 settlements', () => {
    const thickConf = computeConfidence({ settlements: 35, windowDays: 90, daysSinceLastSettlement: 0 });
    const freshConf = computeConfidence({ settlements: 0, windowDays: 0, daysSinceLastSettlement: 999 });
    expect(thickConf).toBeGreaterThan(freshConf);
  });
});

describe('seed-thick-agent script — export contract', () => {
  it('THICK_AGENT_FILE constant is defined and points to .thick-agent.json', async () => {
    const mod = await import('../scripts/seed-thick-agent.js');
    expect(mod.THICK_AGENT_FILE).toContain('.thick-agent.json');
  });

  it('seedThickAgent is an exported async function', async () => {
    const mod = await import('../scripts/seed-thick-agent.js');
    expect(typeof mod.seedThickAgent).toBe('function');
  });

  it('loadThickAgent returns null when file does not exist (offline idempotency check)', async () => {
    const mod = await import('../scripts/seed-thick-agent.js');
    // loadThickAgent reads from an arbitrary path; we pass a non-existent path
    const result = mod.loadThickAgent('/tmp/__nonexistent_thick_agent_test__.json');
    expect(result).toBeNull();
  });

  it('ThickAgentRecord interface shape: address, secret, settlementsCount, firstTxDate', async () => {
    const mod = await import('../scripts/seed-thick-agent.js');
    const sample: import('../scripts/seed-thick-agent.js').ThickAgentRecord = {
      address: 'rSampleAddress',
      secret: 's████████████████████████████',
      settlementsCount: 35,
      firstTxDate: new Date().toISOString(),
    };
    expect(sample.address).toBeDefined();
    expect(sample.secret).toBeDefined();
    expect(sample.settlementsCount).toBe(35);
    expect(sample.firstTxDate).toBeDefined();
  });
});
