// Tier + Confidence engine — deterministic Bronze→Platinum underwriting path.
// Replaces the 100-point scorecard lookup for the v2+ passport. The old score()
// and tierFromScore() functions in scorecard.ts remain intact for backward-compat.

export type PassportTier = 'DENIED' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

/** Absolute USD vouching ceilings per tier. These are ABSTRACT limits used for gate
 *  logic and display ONLY — they are NOT the on-chain RLUSD transfer amount. */
export const TIER_CEILING: Record<PassportTier, string> = {
  DENIED:   '0',
  BRONZE:   '100',
  SILVER:   '500',
  GOLD:     '2000',
  PLATINUM: '10000',
};

export interface TierInput {
  /** D1 — principal identity verified (Zefix/WorldID/delegation chain) */
  d1: boolean;
  /** D2 — human accountability (World ID orb/device) */
  d2: boolean;
  /** D3 — code provenance (runtime hash matches credential's sh field) */
  d3: boolean;
  /** D5 — principal-signed capability mandate present */
  d5Mandate: boolean;
  /** D6 — AML outcome; 'DENY' blocks issuance entirely */
  d6: 'PASS' | 'REVIEW' | 'DENY';
  /** D6 shorthand: if true, forces DENIED regardless of d6 field */
  amlHit?: boolean;
  /** Principal kind — pseudonymous is capped at BRONZE regardless of maturity */
  principal: 'org' | 'individual' | 'parent-agent' | 'pseudonymous';
  /** Third-party clean settlements (self-loops excluded per D4 derivation) */
  settlements: number;
  /** Observation window length in days */
  windowDays: number;
  /** Escrow/payment success rate (0..1) */
  successRate?: number;
  /** Consecutive clean days (no incidents) */
  cleanStreakDays?: number;
  /** Operator tier string, e.g. 'BTIER-3' */
  operatorBtier?: string;
}

export interface TierResult {
  tier: PassportTier;
  ceiling: string;
}

/** Deterministic tier lookup.
 *
 * Tier table (spec §7):
 *
 * | Tier     | Requirement                                                         | Ceiling  |
 * |----------|---------------------------------------------------------------------|---------|
 * | DENIED   | AML hit, or no D1, or D3 fail                                       | $0      |
 * | BRONZE   | D1+D2+D3+D6=PASS (D2 optional but required for BRONZE label)        | $100    |
 * | SILVER   | BRONZE + D5 mandate + ≥10 clean 3rd-party settlements + ≥30d window | $500    |
 * | GOLD     | SILVER + ≥30 settlements + ≥90d + ≥0.98 success rate               | $2,000  |
 * | PLATINUM | GOLD + ≥90d clean streak + operator BTIER-3+                        | $10,000 |
 *
 * Pseudonymous cap: max BRONZE regardless of behavioral maturity.
 */
export function computeTier(input: TierInput): TierResult {
  const denied = (tier: PassportTier = 'DENIED'): TierResult => ({
    tier,
    ceiling: TIER_CEILING[tier],
  });

  // --- Hard blockers (DENIED gate) ---
  if (input.amlHit || input.d6 === 'DENY') return denied();
  if (!input.d1) return denied();
  if (!input.d3) return denied();

  // --- BRONZE floor: D1 + D2 + D3 + D6 pass ---
  // (D2 required by spec; d6 must be PASS or at most REVIEW for BRONZE)
  if (!input.d2) return denied();
  if (input.d6 !== 'PASS' && input.d6 !== 'REVIEW') return denied();

  // Pseudonymous cap — never higher than BRONZE.
  const isPseudonymous = input.principal === 'pseudonymous';

  if (isPseudonymous) {
    return { tier: 'BRONZE', ceiling: TIER_CEILING.BRONZE };
  }

  // --- SILVER: BRONZE + D5 mandate + ≥10 settlements + ≥30d window ---
  const silverMet =
    input.d5Mandate &&
    input.settlements >= 10 &&
    input.windowDays >= 30;

  if (!silverMet) {
    return { tier: 'BRONZE', ceiling: TIER_CEILING.BRONZE };
  }

  // --- GOLD: SILVER + ≥30 settlements + ≥90d + ≥0.98 success rate ---
  const goldMet =
    silverMet &&
    input.settlements >= 30 &&
    input.windowDays >= 90 &&
    (input.successRate ?? 0) >= 0.98;

  if (!goldMet) {
    return { tier: 'SILVER', ceiling: TIER_CEILING.SILVER };
  }

  // --- PLATINUM: GOLD + ≥90d clean streak + operator BTIER-3+ ---
  const platinumMet =
    goldMet &&
    (input.cleanStreakDays ?? 0) >= 90 &&
    operatorAtLeastBtier3(input.operatorBtier);

  if (!platinumMet) {
    return { tier: 'GOLD', ceiling: TIER_CEILING.GOLD };
  }

  return { tier: 'PLATINUM', ceiling: TIER_CEILING.PLATINUM };
}

/** Parse 'BTIER-N' and return true if N >= 3. */
function operatorAtLeastBtier3(btier?: string): boolean {
  if (!btier) return false;
  const m = btier.match(/^BTIER-(\d+)$/i);
  if (!m) return false;
  return parseInt(m[1], 10) >= 3;
}

export interface ConfidenceInput {
  /** Third-party clean settlements */
  settlements: number;
  /** Observation window in days */
  windowDays: number;
  /** Days since last recorded settlement (0 = today) */
  daysSinceLastSettlement: number;
}

/** Confidence score 0–100 (integer).
 *
 * Formula (spec §7):
 *   settlement_score = clamp(settlements / 100, 0, 1)              // full at 100
 *   window_score     = clamp(windowDays / 90, 0, 1)                // full at 90 days
 *   recency_score    = daysSinceLastSettlement == 0
 *                        ? 1
 *                        : clamp(1 / (daysSinceLastSettlement / 30 + 1), 0, 1)
 *   confidence       = round((settlement_score * 0.5
 *                            + window_score     * 0.3
 *                            + recency_score    * 0.2) * 100)
 *
 * Display: "GOLD · 94% confidence · 142 settlements / 90 days."
 */
export function computeConfidence(input: ConfidenceInput): number {
  const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

  const settlementScore = clamp01(input.settlements / 100);
  const windowScore = clamp01(input.windowDays / 90);

  // Recency is only meaningful when there IS at least one settlement.
  // If settlements == 0, there is no history to be recent, so recency contributes 0.
  const recencyScore =
    input.settlements === 0
      ? 0
      : input.daysSinceLastSettlement === 0
        ? 1
        : clamp01(1 / (input.daysSinceLastSettlement / 30 + 1));

  return Math.round(
    (settlementScore * 0.5 + windowScore * 0.3 + recencyScore * 0.2) * 100
  );
}

/** Return the effective payment ceiling: min(tierCeiling, remainingBudget).
 *
 * The tier ceilings are ABSTRACT USD vouching limits for gate-logic and display.
 * If the principal's remaining delegation budget is lower, that smaller value wins.
 */
export function effectiveCeiling(
  tier: PassportTier,
  tierCeiling: string,
  remainingBudget: string
): string {
  const tc = parseFloat(tierCeiling);
  const rb = parseFloat(remainingBudget);
  return String(Math.min(tc, rb));
}
