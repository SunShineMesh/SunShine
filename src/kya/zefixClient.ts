// D1 Org Track — Real Zefix KYB client.
//
// Fetches `CompanyFull` from the ZefixPublicREST API and asserts
// `status === 'ACTIVE'`. Falls back to a local fixture when:
//   - opts.fixture = true
//   - ZEFIX_FIXTURE env var is 'true'
//   - ZEFIX_USERNAME or ZEFIX_PASSWORD are absent
//
// Fixture data: Novartis AG (CHE-103.867.266) — real public record from zefix.ch.
// Source label: "Zefix public registry (cached)"
//
// KybSignals bridge: `buildKybSignalsFromZefix` converts a `ZefixCompanyDetail`
// into the `KybSignals` subset used by `kybScore`. It does NOT modify `kybScore`
// or `delegationCapCheck` — those functions remain pure and unchanged.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { KybSignals } from './kyb.js';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ZefixAddress {
  street: string;
  houseNumber: string;
  swissZipCode: string;
  city: string;
  /** Optional canton sub-field (sometimes present in API responses) */
  canton?: string;
}

export interface ZefixCompanyDetail {
  name: string;
  uid: string;
  status: 'ACTIVE' | 'CANCELLED' | 'BEING_CANCELLED';
  canton: string;
  legalForm: {
    uid: string;
    name: { en: string };
  };
  address: ZefixAddress;
  /** ISO date (YYYY-MM-DD) of first SOGC publication — used for businessAgeDays. */
  sogcDate: string;
  purpose?: string;
  capitalNominal?: string;
  /** Injected by fixture loader to label the data source honestly. */
  _dataSource?: string;
}

export interface ZefixLookupOpts {
  /** Force fixture mode: never hits the network. */
  fixture?: boolean;
}

/** Thrown when the Zefix API returns HTTP 401 Unauthorized. */
export class ZefixAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZefixAuthError';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const ZEFIX_BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1';

/** Strip hyphens and dots from a UID: 'CHE-103.867.266' → 'CHE103867266' */
function normalizeUid(uid: string): string {
  return uid.replace(/[-\.]/g, '');
}

/** Resolve a path relative to this file's directory (handles both CJS and ESM). */
function resolveFromHere(relative: string): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return resolve(__dirname, relative);
  } catch {
    // fallback for environments where import.meta.url is unavailable
    return resolve(relative);
  }
}

function fixtureDetailPath(): string {
  // Try repo-relative path first (works from project root)
  const repoRelative = 'fixtures/zefix_novartis_detail.json';
  if (existsSync(repoRelative)) return repoRelative;

  // Try relative to this source file (src/kya → ../../fixtures)
  const srcRelative = resolveFromHere('../../fixtures/zefix_novartis_detail.json');
  if (existsSync(srcRelative)) return srcRelative;

  // Compiled dist path (dist/kya → ../../fixtures)
  return resolveFromHere('../../fixtures/zefix_novartis_detail.json');
}

function loadFixtureDetail(): ZefixCompanyDetail {
  const path = fixtureDetailPath();
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw) as ZefixCompanyDetail;
  // Inject honest data-source label
  return {
    ...data,
    _dataSource: 'Zefix public registry (cached)',
  };
}

function shouldUseFixture(opts?: ZefixLookupOpts): boolean {
  if (opts?.fixture === true) return true;
  if (opts?.fixture === false) return false; // explicit override
  if (process.env.ZEFIX_FIXTURE === 'true') return true;
  // No credentials → use fixture
  if (!process.env.ZEFIX_USERNAME || !process.env.ZEFIX_PASSWORD) return true;
  return false;
}

async function fetchDetail(uid: string): Promise<ZefixCompanyDetail> {
  const normalizedUid = normalizeUid(uid);
  const url = `${ZEFIX_BASE}/company/uid/${normalizedUid}`;

  const username = process.env.ZEFIX_USERNAME ?? '';
  const password = process.env.ZEFIX_PASSWORD ?? '';
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    },
  });

  if (response.status === 401) {
    throw new ZefixAuthError(
      `Zefix API returned 401 Unauthorized for UID ${uid}. ` +
      'Check ZEFIX_USERNAME and ZEFIX_PASSWORD environment variables.'
    );
  }

  if (!response.ok) {
    throw new Error(
      `Zefix API error: HTTP ${response.status} for UID ${uid}`
    );
  }

  const data = await response.json() as ZefixCompanyDetail;
  return data;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a company by UID from the Swiss commercial register (Zefix).
 *
 * Falls back to the local fixture (Novartis AG) when credentials are absent
 * or `opts.fixture=true`. The fixture is labelled honestly as
 * "Zefix public registry (cached)".
 *
 * @param params.uid  Swiss UID, e.g. 'CHE-103.867.266' (hyphens and dots OK)
 * @param opts        Optional flags: `{ fixture: true }` forces fixture mode.
 * @throws ZefixAuthError  When the API returns 401 (bad credentials).
 */
export async function zefixLookup(
  params: { uid: string },
  opts?: ZefixLookupOpts,
): Promise<ZefixCompanyDetail> {
  if (shouldUseFixture(opts)) {
    return loadFixtureDetail();
  }
  return fetchDetail(params.uid);
}

/**
 * Convert a `ZefixCompanyDetail` into the `KybSignals` fields that can be
 * derived directly from a registry record.
 *
 * Returns only the subset of `KybSignals` that Zefix provides:
 *   - `entityVerified`        — true iff `status === 'ACTIVE'`
 *   - `businessAgeDays`       — days since first SOGC publication
 *   - `registeredJurisdiction`— the canton code (e.g. 'BS')
 *
 * The caller must supply the remaining `KybSignals` fields
 * (`operatorSettlementRate`) from other sources before passing to `kybScore`.
 *
 * @param detail   The Zefix company detail record.
 * @param now      Optional override for the current timestamp (unix ms). Defaults
 *                 to `Date.now()`. Useful in tests for deterministic age.
 */
export function buildKybSignalsFromZefix(
  detail: ZefixCompanyDetail,
  now?: number,
): Pick<KybSignals, 'entityVerified' | 'businessAgeDays' | 'registeredJurisdiction'> {
  const entityVerified = detail.status === 'ACTIVE';

  let businessAgeDays = 0;
  if (entityVerified && detail.sogcDate) {
    const sogcMs = new Date(detail.sogcDate).getTime();
    const nowMs = now ?? Date.now();
    businessAgeDays = Math.max(0, Math.floor((nowMs - sogcMs) / (1000 * 60 * 60 * 24)));
  }

  return {
    entityVerified,
    businessAgeDays,
    registeredJurisdiction: detail.canton,
  };
}
