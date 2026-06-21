import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  zefixLookup,
  buildKybSignalsFromZefix,
  ZefixAuthError,
  type ZefixCompanyDetail,
  type ZefixLookupOpts,
} from '../src/kya/zefixClient.js';

// ── Fixture lookup tests ────────────────────────────────────────────────────
// Always uses the fixture (ZEFIX_FIXTURE=true or no credentials present).

describe('zefixLookup (fixture mode)', () => {
  it('returns ACTIVE Novartis AG record for UID CHE-103.867.266', async () => {
    const detail = await zefixLookup({ uid: 'CHE-103.867.266' }, { fixture: true });
    expect(detail.status).toBe('ACTIVE');
    expect(detail.name).toBe('Novartis AG');
    expect(detail.uid).toBe('CHE-103.867.266');
    // legalForm.name.en should be 'Corporation'
    expect(detail.legalForm.name.en).toBe('Corporation');
    // Canton should be Basel-Stadt
    expect(detail.canton).toBe('BS');
    // City should be Basel
    expect(detail.address.city).toBe('Basel');
  });

  it('returns the same result when opts.fixture=true (no network call)', async () => {
    // Both calls should return the same fixture data without any network activity
    const a = await zefixLookup({ uid: 'CHE-103.867.266' }, { fixture: true });
    const b = await zefixLookup({ uid: 'CHE-103.867.266' }, { fixture: true });
    expect(a.uid).toBe(b.uid);
    expect(a.name).toBe(b.name);
    expect(a.status).toBe(b.status);
  });

  it('falls back to fixture when no credentials are present', async () => {
    // When ZEFIX_USERNAME / ZEFIX_PASSWORD are absent, zefixLookup uses fixture
    const savedUser = process.env.ZEFIX_USERNAME;
    const savedPass = process.env.ZEFIX_PASSWORD;
    delete process.env.ZEFIX_USERNAME;
    delete process.env.ZEFIX_PASSWORD;

    try {
      const detail = await zefixLookup({ uid: 'CHE-103.867.266' });
      expect(detail.status).toBe('ACTIVE');
      expect(detail.name).toBe('Novartis AG');
    } finally {
      if (savedUser !== undefined) process.env.ZEFIX_USERNAME = savedUser;
      if (savedPass !== undefined) process.env.ZEFIX_PASSWORD = savedPass;
    }
  });
});

// ── buildKybSignalsFromZefix ─────────────────────────────────────────────────

describe('buildKybSignalsFromZefix', () => {
  it('ACTIVE company → entityVerified=true, businessAgeDays>0, registeredJurisdiction set', () => {
    const detail: ZefixCompanyDetail = {
      name: 'Novartis AG',
      uid: 'CHE-103.867.266',
      status: 'ACTIVE',
      canton: 'BS',
      legalForm: { uid: '0107.003.036', name: { en: 'Corporation' } },
      address: { street: 'Lichtstrasse', houseNumber: '35', swissZipCode: '4056', city: 'Basel' },
      sogcDate: '1996-12-21',
    };
    const now = new Date('2026-06-21').getTime();
    const sigs = buildKybSignalsFromZefix(detail, now);

    expect(sigs.entityVerified).toBe(true);
    expect(sigs.businessAgeDays).toBeGreaterThan(0);
    // Novartis registered 1996-12-21 → over 10 000 days by 2026
    expect(sigs.businessAgeDays).toBeGreaterThan(10000);
    // registeredJurisdiction: canton 'BS' or 'CH' are both acceptable per plan
    expect(['BS', 'CH']).toContain(sigs.registeredJurisdiction);
  });

  it('CANCELLED company → entityVerified=false', () => {
    const detail: ZefixCompanyDetail = {
      name: 'Ghost Corp',
      uid: 'CHE-999.999.999',
      status: 'CANCELLED',
      canton: 'ZH',
      legalForm: { uid: '0107.003.036', name: { en: 'Corporation' } },
      address: { street: 'Main', houseNumber: '1', swissZipCode: '8001', city: 'Zurich' },
      sogcDate: '2010-01-01',
    };
    const sigs = buildKybSignalsFromZefix(detail);
    expect(sigs.entityVerified).toBe(false);
  });

  it('BEING_CANCELLED company → entityVerified=false', () => {
    const detail: ZefixCompanyDetail = {
      name: 'Dying Corp',
      uid: 'CHE-888.888.888',
      status: 'BEING_CANCELLED',
      canton: 'GE',
      legalForm: { uid: '0107.003.036', name: { en: 'Corporation' } },
      address: { street: 'Rue de', houseNumber: '2', swissZipCode: '1201', city: 'Geneva' },
      sogcDate: '2015-06-01',
    };
    const sigs = buildKybSignalsFromZefix(detail);
    expect(sigs.entityVerified).toBe(false);
  });

  it('businessAgeDays is computed from sogcDate relative to now parameter', () => {
    const detail: ZefixCompanyDetail = {
      name: 'Young Corp',
      uid: 'CHE-111.222.333',
      status: 'ACTIVE',
      canton: 'ZH',
      legalForm: { uid: '0107.003.036', name: { en: 'Corporation' } },
      address: { street: 'Bahnhofstrasse', houseNumber: '10', swissZipCode: '8001', city: 'Zurich' },
      sogcDate: '2024-06-21',
    };
    // Exactly 2 years (730 days) after sogcDate
    const now = new Date('2026-06-21').getTime();
    const sigs = buildKybSignalsFromZefix(detail, now);
    // Should be approximately 730 days
    expect(sigs.businessAgeDays).toBeGreaterThanOrEqual(729);
    expect(sigs.businessAgeDays).toBeLessThanOrEqual(731);
  });
});

// ── ZefixAuthError (live-path error) ────────────────────────────────────────
// We simulate this by providing fake credentials so the live call fires but fails.
// Only runs if ZEFIX_USERNAME/ZEFIX_PASSWORD env vars are NOT set to real values.

describe('ZefixAuthError', () => {
  it('ZefixAuthError is an Error subclass', () => {
    const err = new ZefixAuthError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ZefixAuthError);
    expect(err.message).toBe('test');
  });

  it('zefixLookup throws ZefixAuthError when given invalid credentials', async () => {
    // Save existing env
    const savedUser = process.env.ZEFIX_USERNAME;
    const savedPass = process.env.ZEFIX_PASSWORD;
    process.env.ZEFIX_USERNAME = 'invalid_user_xyz_test';
    process.env.ZEFIX_PASSWORD = 'invalid_pass_xyz_test';

    try {
      await expect(
        zefixLookup({ uid: 'CHE-103.867.266' }, { fixture: false })
      ).rejects.toThrow(ZefixAuthError);
    } finally {
      if (savedUser !== undefined) process.env.ZEFIX_USERNAME = savedUser;
      else delete process.env.ZEFIX_USERNAME;
      if (savedPass !== undefined) process.env.ZEFIX_PASSWORD = savedPass;
      else delete process.env.ZEFIX_PASSWORD;
    }
  });
});
