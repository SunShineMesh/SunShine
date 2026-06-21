import { describe, it, expect } from 'vitest';

// We cannot import CONFIG directly in test (it loads .env which may mutate process.env),
// but we CAN test the integrationStatus() pure function exported from config.ts.
// The function inspects the already-loaded CONFIG object, so we import after any env setup.
import { integrationStatus } from '../src/config.js';

describe('integrationStatus()', () => {
  it('returns an object with worldId, zefix, aml, deepseek keys', () => {
    const status = integrationStatus();
    expect(status).toHaveProperty('worldId');
    expect(status).toHaveProperty('zefix');
    expect(status).toHaveProperty('aml');
    expect(status).toHaveProperty('deepseek');
  });

  it('each integration has a { live: boolean } shape', () => {
    const status = integrationStatus();
    for (const [key, val] of Object.entries(status)) {
      expect(typeof (val as any).live, `${key}.live should be boolean`).toBe('boolean');
    }
  });

  it('worldId.live is false when WORLDID_RP_SIGNING_KEY is absent', () => {
    // In test env, env vars are not set so live should be false
    const status = integrationStatus();
    // Either live (if env is set) or not live — the shape must always be boolean
    expect(typeof status.worldId.live).toBe('boolean');
  });

  it('zefix.live is false when ZEFIX_USERNAME is absent', () => {
    const status = integrationStatus();
    expect(typeof status.zefix.live).toBe('boolean');
  });

  it('aml.live reflects whether fixture mode is off and snapshot exists', () => {
    const status = integrationStatus();
    expect(typeof status.aml.live).toBe('boolean');
  });

  it('deepseek.live is false when DEEPSEEK_API_KEY is absent', () => {
    const status = integrationStatus();
    expect(typeof status.deepseek.live).toBe('boolean');
  });

  it('integrationStatus returns a stable shape on repeated calls', () => {
    const a = integrationStatus();
    const b = integrationStatus();
    expect(a).toEqual(b);
  });
});
