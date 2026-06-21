// Content-addressed KYA/KYB dossier — the off-chain risk narrative behind a
// credential's on-ledger `ref`. Holds the FULL code hashes (ih/sh on-ledger are
// prefixes), the operator accountability chain (op8 on-ledger is a prefix), the
// KYA signals snapshot, and screening results. The on-ledger `r` == this dossier's
// content hash, so the ledger anchor proves the dossier wasn't swapped. The dossier
// content is the per-pull moat (the ledger is free to read; this is not).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Signals } from './scorecard.js';
import type { DimensionRecord } from './dimension.js';
import type { ScreeningResult } from './aml.js';

export interface Dossier {
  ref: string;                 // 16-hex content pointer (== on-ledger r)
  agentAddr: string;
  operatorCredId?: string;     // full operator cred id (op8 on-ledger is its prefix)
  harnessHashFull: string;     // 64 hex (ih on-ledger is its prefix)
  skillHashFull: string;       // 64 hex (sh on-ledger is its prefix)
  score: number;
  tier: string;
  signals: Signals;
  screening: { sanctions: 'clear' | 'hit' | 'stub'; pep: 'clear' | 'hit' | 'stub'; provider: string };
  /** Six-dimension evidence bundle (one record per D1–D6). Optional for backward-compat. */
  dimensions?: DimensionRecord[];
  /** Full AML screening result (stored off-ledger; only the action goes on-ledger). */
  amlResult?: ScreeningResult;
  createdAt: number;           // unix ms (caller-supplied; keeps this module pure)
}

export type DossierInput = Omit<Dossier, 'ref'>;

/** Deterministic canonical JSON: sorts object keys at every nesting level. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(o[k])).join(',') + '}';
}

/** Deterministic 16-hex content hash of the dossier (excludes ref). */
export function dossierRefOf(input: DossierInput): string {
  return createHash('sha256').update(canonicalize(input)).digest('hex').toUpperCase().slice(0, 16);
}

export function buildDossier(input: DossierInput): Dossier {
  return { ...input, ref: dossierRefOf(input) };
}

/** File-backed dossier store (mirrors PaymentStore). Keyed by ref. */
export class DossierStore {
  constructor(private path: string) {}
  private read(): Record<string, Dossier> {
    if (!existsSync(this.path)) return {};
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, Dossier>; } catch { return {}; }
  }
  private write(m: Record<string, Dossier>): void { writeFileSync(this.path, JSON.stringify(m, null, 2)); }
  put(d: Dossier): Dossier { const m = this.read(); m[d.ref] = d; this.write(m); return d; }
  get(ref: string): Dossier | undefined { return this.read()[ref]; }
}
