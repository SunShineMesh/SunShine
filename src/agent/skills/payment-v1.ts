// A real (small) agent skill module. Its on-disk BYTES are SHA-256'd into the
// credential's `sh` anchor + dossier full-hash. Swapping this file for un-audited
// code changes the hash → "unrecognized runtime" at the gate (demo step ④).
export const SKILL_ID = 'cross-border-payment';
export const SKILL_VERSION = '1.0.0';

/** Pure policy the audited skill promises to follow: validate → escrow → await human. */
export function paymentPolicy(amount: number, maxTxAmount: number): 'escrow' | 'reject' {
  return amount > 0 && amount <= maxTxAmount ? 'escrow' : 'reject';
}
