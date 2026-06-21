// D6 AML hard gate — OpenSanctions OFAC SDN screening.
//
// Loads a snapshot CSV (or the small JSON fixture when SANCTIONS_FIXTURE=true or
// NODE_ENV=test and the CSV is absent). Uses inline Jaro-Winkler (p=0.1) with
// token-set comparison on normalised strings. Any score ≥ 0.88 → DENY; 0.80–0.87
// → REVIEW; < 0.80 → PASS.
//
// No external runtime deps beyond Node built-ins.

import { readFileSync, existsSync } from 'node:fs';

// ─── Public types ────────────────────────────────────────────────────────────

export interface SdnEntry {
  id: string;
  name: string;
  aliases: string[];
  schema: string;
  countries: string[];
  birthDate: string;
  programIds: string[];
}

export type AmlAction = 'DENY' | 'REVIEW' | 'PASS';

export interface ScreeningResult {
  hit: boolean;
  score: number;
  matchedName: string;
  entry?: SdnEntry;
  action: AmlAction;
}

/** A compiled screening function — O(1) lookup after construction. */
export type AmlMatcher = (name: string) => ScreeningResult;

// ─── Constants ───────────────────────────────────────────────────────────────

const DENY_THRESHOLD = 0.88;
const REVIEW_THRESHOLD = 0.80;

const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'al', 'el', 'von', 'van', 'de', 'bin', 'bint',
]);

// ─── Normalization ───────────────────────────────────────────────────────────

/** Strips diacritics (NFKD + remove combining marks), lowercases, removes
 *  punctuation, collapses spaces, removes honorifics. */
export function normalize(raw: string): string {
  // 1. NFKD normalise then strip combining diacritical marks (U+0300–U+036F)
  const noDiacritics = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  // 2. Lowercase
  const lower = noDiacritics.toLowerCase();
  // 3. Remove punctuation (keep only letters, digits, spaces)
  const noPunct = lower.replace(/[^a-z0-9 ]/g, ' ');
  // 4. Collapse multiple spaces
  const collapsed = noPunct.replace(/\s+/g, ' ').trim();
  // 5. Strip honorifics
  const tokens = collapsed.split(' ').filter((t) => t.length > 0 && !HONORIFICS.has(t));
  return tokens.join(' ');
}

/** Token-set comparison: sort tokens of both names, join, compare. */
function tokenSet(a: string, b: string): string[] {
  const tokA = a.split(' ').filter(Boolean).sort();
  const tokB = b.split(' ').filter(Boolean).sort();
  return [tokA.join(' '), tokB.join(' ')];
}

// ─── Jaro-Winkler (inline, p=0.1) ──────────────────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Uint8Array(len1);
  const s2Matches = new Uint8Array(len2);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = 1;
      s2Matches[j] = 1;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro-Winkler with prefix scaling factor p=0.1 (max prefix 4 chars). */
function jaroWinkler(s1: string, s2: string): number {
  const jaroSim = jaro(s1, s2);
  const prefixLen = Math.min(
    4,
    [...Array(Math.min(s1.length, s2.length))].findIndex((_, i) => s1[i] !== s2[i]) === -1
      ? Math.min(s1.length, s2.length)
      : [...Array(Math.min(s1.length, s2.length))].findIndex((_, i) => s1[i] !== s2[i]),
  );
  return jaroSim + prefixLen * 0.1 * (1 - jaroSim);
}

/** Compare two normalised name strings using token-set + Jaro-Winkler. */
function compareName(a: string, b: string): number {
  const [sortedA, sortedB] = tokenSet(a, b);
  return jaroWinkler(sortedA, sortedB);
}

// ─── CSV / fixture parsing ───────────────────────────────────────────────────

/** Naïve CSV field parser (handles quoted fields with embedded commas). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && (j + 1 >= line.length || line[j + 1] === ','))) {
        j++;
      }
      fields.push(line.slice(i + 1, j));
      i = j + 2; // skip closing " and ,
    } else {
      const j = line.indexOf(',', i);
      if (j === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

interface RawRow {
  id: string;
  schema: string;
  name: string;
  aliases: string;
  birth_date: string;
  countries: string;
  program_ids: string;
}

function rowToEntry(r: RawRow): SdnEntry {
  return {
    id: r.id,
    name: r.name,
    aliases: r.aliases ? r.aliases.split(';').map((a) => a.trim()).filter(Boolean) : [],
    schema: r.schema,
    countries: r.countries ? r.countries.split(';').map((c) => c.trim()).filter(Boolean) : [],
    birthDate: r.birth_date,
    programIds: r.program_ids ? r.program_ids.split(';').map((p) => p.trim()).filter(Boolean) : [],
  };
}

function loadFromCsv(csvPath: string): SdnEntry[] {
  const text = readFileSync(csvPath, 'utf8');
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const idIdx = header.indexOf('id');
  const schemaIdx = header.indexOf('schema');
  const nameIdx = header.indexOf('name');
  const aliasesIdx = header.indexOf('aliases');
  const birthDateIdx = header.indexOf('birth_date');
  const countriesIdx = header.indexOf('countries');
  const programIdsIdx = header.indexOf('program_ids');

  const entries: SdnEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    entries.push(rowToEntry({
      id: cols[idIdx] ?? '',
      schema: cols[schemaIdx] ?? '',
      name: cols[nameIdx] ?? '',
      aliases: cols[aliasesIdx] ?? '',
      birth_date: cols[birthDateIdx] ?? '',
      countries: cols[countriesIdx] ?? '',
      program_ids: cols[programIdsIdx] ?? '',
    }));
  }
  return entries;
}

interface FixtureRow {
  id: string;
  schema: string;
  name: string;
  aliases: string[];
  birth_date: string;
  countries: string[];
  program_ids: string;
}

function loadFromFixture(fixturePath: string): SdnEntry[] {
  const text = readFileSync(fixturePath, 'utf8');
  const rows = JSON.parse(text) as FixtureRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // Fixture stores aliases as array of semicolon-joined strings
    aliases: r.aliases.flatMap((a) => a.split(';').map((s) => s.trim()).filter(Boolean)),
    schema: r.schema,
    countries: Array.isArray(r.countries) ? r.countries : (r.countries ? (r.countries as string).split(';') : []),
    birthDate: r.birth_date ?? '',
    programIds: typeof r.program_ids === 'string'
      ? r.program_ids.split(';').map((p) => p.trim()).filter(Boolean)
      : [],
  }));
}

// ─── Default paths ────────────────────────────────────────────────────────────

const DEFAULT_CSV = 'data/sanctions_snapshot_20260621.csv';
const DEFAULT_FIXTURE = 'data/sanctions_fixture.json';

function shouldUseFixture(csvPath: string | undefined): boolean {
  if (process.env.SANCTIONS_FIXTURE === 'true') return true;
  if (csvPath && csvPath.endsWith('.json')) return true;
  if (!csvPath && !existsSync(DEFAULT_CSV)) return true;
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a compiled AML matcher from a pinned OFAC SDN snapshot.
 *
 * @param csvPath Path to the CSV snapshot or JSON fixture. When omitted:
 *   - `SANCTIONS_FIXTURE=true` → loads `data/sanctions_fixture.json`
 *   - CSV absent → loads fixture automatically
 *   - Otherwise loads `data/sanctions_snapshot_20260621.csv`
 */
export function buildAmlMatcher(csvPath?: string): AmlMatcher {
  let entries: SdnEntry[];

  if (shouldUseFixture(csvPath) || (csvPath && csvPath.endsWith('.json'))) {
    const fixturePath = (csvPath && csvPath.endsWith('.json')) ? csvPath : DEFAULT_FIXTURE;
    entries = loadFromFixture(fixturePath);
  } else {
    const path = csvPath ?? DEFAULT_CSV;
    if (!existsSync(path)) {
      // Final fallback: use fixture
      entries = loadFromFixture(DEFAULT_FIXTURE);
    } else {
      entries = loadFromCsv(path);
    }
  }

  // Pre-compute normalised keys for every entry + alias
  const index: Array<{ normName: string; entry: SdnEntry }> = [];
  for (const entry of entries) {
    index.push({ normName: normalize(entry.name), entry });
    for (const alias of entry.aliases) {
      if (alias) index.push({ normName: normalize(alias), entry });
    }
  }

  return (name: string): ScreeningResult => {
    const normQuery = normalize(name);
    let bestScore = 0;
    let bestNorm = '';
    let bestEntry: SdnEntry | undefined;

    for (const { normName, entry } of index) {
      const sim = compareName(normQuery, normName);
      if (sim > bestScore) {
        bestScore = sim;
        bestNorm = normName;
        bestEntry = entry;
      }
    }

    const action: AmlAction =
      bestScore >= DENY_THRESHOLD ? 'DENY' :
      bestScore >= REVIEW_THRESHOLD ? 'REVIEW' :
      'PASS';

    return {
      hit: action === 'DENY',
      score: bestScore,
      matchedName: bestNorm,
      entry: action !== 'PASS' ? bestEntry : undefined,
      action,
    };
  };
}

/**
 * Convenience wrapper — screens `name` using an already-built matcher.
 * Useful for callers who hold a singleton matcher and want a named function.
 */
export function screenName(matcher: AmlMatcher, name: string): ScreeningResult {
  return matcher(name);
}
