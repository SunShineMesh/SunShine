// Minimal-real L3 — content attestation (version-pinning + accountability, NOT TEE).
// Real SHA-256 of harness + skill bytes. Full hashes -> off-chain dossier (the
// binding); 8-char ih/sh prefixes -> on-ledger URI (the anchor). At the gate,
// recompute the presented code's hash and compare; a mismatch is an "unrecognized
// runtime". Spike-proven in spike-l3-attest.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256Hex = (b: Buffer | string): string =>
  createHash('sha256').update(b).digest('hex').toUpperCase();

export const prefix8 = (full: string): string => full.slice(0, 8);

export interface Attestation {
  harnessHashFull: string; // 64 hex
  skillHashFull: string;   // 64 hex
  ih: string;              // 8 hex (on-ledger harness anchor)
  sh: string;              // 8 hex (on-ledger skill anchor)
}

export function attest(harnessBytes: Buffer | string, skillBytes: Buffer | string): Attestation {
  const harnessHashFull = sha256Hex(harnessBytes);
  const skillHashFull = sha256Hex(skillBytes);
  return { harnessHashFull, skillHashFull, ih: prefix8(harnessHashFull), sh: prefix8(skillHashFull) };
}

export interface VerifyResult {
  recognized: boolean;
  harnessMatch: boolean;
  skillMatch: boolean;
  reason: string;
}

export function verifyAttestation(
  presentedHarness: Buffer | string,
  presentedSkill: Buffer | string,
  expected: { harnessHashFull: string; skillHashFull: string },
): VerifyResult {
  const harnessMatch = sha256Hex(presentedHarness) === expected.harnessHashFull;
  const skillMatch = sha256Hex(presentedSkill) === expected.skillHashFull;
  const recognized = harnessMatch && skillMatch;
  return {
    recognized, harnessMatch, skillMatch,
    reason: recognized
      ? 'recognized runtime'
      : `unrecognized runtime (${!harnessMatch ? 'harness' : 'skill'} hash mismatch)`,
  };
}

/** fs convenience: hash real files. Keeps the core functions pure/testable. */
export function attestFiles(harnessPath: string, skillPath: string): Attestation {
  return attest(readFileSync(harnessPath), readFileSync(skillPath));
}
