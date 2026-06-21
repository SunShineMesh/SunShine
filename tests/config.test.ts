import { describe, it, expect } from 'vitest';

// integrationStatus() reads from the already-loaded CONFIG (which pulls .env),
// so its live values depend on what credentials the developer has set.
// We test SHAPE via integrationStatus() and test LOGIC via the exported
// computeIntegrationStatus() pure function, injecting known config values.
import { integrationStatus, computeIntegrationStatus } from '../src/config.js';

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

  it('integrationStatus returns a stable shape on repeated calls', () => {
    const a = integrationStatus();
    const b = integrationStatus();
    expect(a).toEqual(b);
  });
});

describe('computeIntegrationStatus() — pure logic with injected config', () => {
  it('worldId.live is false when rpSigningKey is absent', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: 'rp_test' },
      zefix: { username: 'u', password: 'p', useFixture: false },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: 'sk-test' },
    });
    expect(status.worldId.live).toBe(false);
  });

  it('worldId.live is false when rpId is absent even if signing key is set', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '0xdeadbeef', rpId: '' },
      zefix: { username: 'u', password: 'p', useFixture: false },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: 'sk-test' },
    });
    expect(status.worldId.live).toBe(false);
  });

  it('worldId.live is true when both rpSigningKey and rpId are set', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '0xdeadbeef', rpId: 'rp_test' },
      zefix: { username: 'u', password: 'p', useFixture: false },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.worldId.live).toBe(true);
  });

  it('zefix.live is false when ZEFIX_USERNAME is absent', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: '', password: '', useFixture: false },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.zefix.live).toBe(false);
  });

  it('zefix.live is false when useFixture=true even if credentials are set', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: 'user', password: 'pass', useFixture: true },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.zefix.live).toBe(false);
  });

  it('zefix.live is true when credentials are set and useFixture=false', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: 'user', password: 'pass', useFixture: false },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.zefix.live).toBe(true);
  });

  it('aml.live is false when useFixture=true', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: '', password: '', useFixture: true },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.aml.live).toBe(false);
  });

  it('aml.live is false when snapshotPath does not exist on disk', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: '', password: '', useFixture: false },
      aml: { useFixture: false, snapshotPath: 'data/this-file-definitely-does-not-exist.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.aml.live).toBe(false);
  });

  it('deepseek.live is false when DEEPSEEK_API_KEY is absent', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: '', password: '', useFixture: true },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: '' },
    });
    expect(status.deepseek.live).toBe(false);
  });

  it('deepseek.live is true when DEEPSEEK_API_KEY is set', () => {
    const status = computeIntegrationStatus({
      worldId: { rpSigningKey: '', rpId: '' },
      zefix: { username: '', password: '', useFixture: true },
      aml: { useFixture: true, snapshotPath: 'data/nonexistent.csv' },
      deepseek: { apiKey: 'sk-real-key' },
    });
    expect(status.deepseek.live).toBe(true);
  });
});
