// Pure KYB (Know-Your-Business) scorecard for MeshCredit operator-layer.
// No I/O — pure functions only (TDD-friendly).
//
// KYB signals feed into a business tier (BTIER-1 … BTIER-4) and a delegation
// authority ceiling (maxDelegatedSpend) that caps the sum of all sub-agent
// allocated spend under the operator. A separate delegationCapCheck() function
// enforces allocatedTotal + requestedAllocation <= maxDelegatedSpend at
// origination time.

/** Input signals for the KYB operator scorecard. */
export interface KybSignals {
  /** Entity has been verified by a KYB provider (binary gate). */
  entityVerified: boolean;
  /** Age of the registered legal entity in days. */
  businessAgeDays: number;
  /** ISO-2 or FATF jurisdiction code (e.g. "CH", "SG", "US"). */
  registeredJurisdiction: string;
  /** 0..1 — historic on-time settlement rate of this operator's prior MeshCredit usage. */
  operatorSettlementRate: number;
}

export type BusinessTier = 'DENIED' | 'BTIER-1' | 'BTIER-2' | 'BTIER-3' | 'BTIER-4';

/** Output of the KYB scorecard. */
export interface KybDecision {
  btier: BusinessTier;
  /** Max total spend this operator may delegate across ALL its sub-agents (IOU-safe string). */
  maxDelegatedSpend: string;
}

/** Input for aggregate cap enforcement. */
export interface AggCapInput {
  /** Operator's delegation ceiling from its KYB credential URI. */
  maxDelegatedSpend: string;
  /** Sum of all currently allocated sub-agent spend under this operator. */
  allocatedTotal: string;
  /** Proposed new allocation amount. */
  requestedAllocation: string;
}

/** Result of aggregate cap enforcement. */
export interface AggCapResult {
  allowed: boolean;
  /** Present only when denied; explains the violation. */
  reason?: string;
}

// ── FATF-recognised "clean" jurisdictions that earn a small bonus ─────────────
// This is a narrow whitelist; unknown codes get no bonus (not a penalty).
const HIGH_QUALITY_JURISDICTIONS = new Set([
  'CH', 'SG', 'GB', 'US', 'DE', 'FR', 'NL', 'SE', 'NO', 'FI', 'DK',
  'AU', 'NZ', 'CA', 'JP', 'HK',
]);

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/**
 * 0–100 KYB score derived from operator signals.
 *
 * Point breakdown (total 100):
 *   entityVerified         40 pts  (binary gate — no credential without this)
 *   businessAgeDays        25 pts  (linear: full at >= 1460 days / 4 years)
 *   jurisdiction           10 pts  (FATF whitelist bonus)
 *   operatorSettlementRate 25 pts  (0..1 scaled)
 */
function kybScoreRaw(s: KybSignals): number {
  if (!s.entityVerified) return 0; // hard gate

  let pts = 40; // entity verified
  pts += clamp01(Math.max(s.businessAgeDays, 0) / 1460) * 25; // full at 4 years
  if (HIGH_QUALITY_JURISDICTIONS.has(s.registeredJurisdiction)) pts += 10;
  pts += clamp01(s.operatorSettlementRate) * 25;
  return Math.round(Math.min(pts, 100));
}

/**
 * Map a KYB score to a business tier and operator delegation authority and spending scope.
 *
 * Score thresholds:
 *   < 40  → DENIED      (entityVerified = false always lands here)
 *   40–54 → BTIER-1     maxDelegatedSpend $500
 *   55–69 → BTIER-2     maxDelegatedSpend $2 500
 *   70–84 → BTIER-3     maxDelegatedSpend $10 000
 *   >= 85 → BTIER-4     maxDelegatedSpend $50 000
 */
export function kybScore(signals: KybSignals): KybDecision {
  const sc = kybScoreRaw(signals);
  if (sc < 40) return { btier: 'DENIED', maxDelegatedSpend: '0' };
  if (sc < 55) return { btier: 'BTIER-1', maxDelegatedSpend: '500' };
  if (sc < 70) return { btier: 'BTIER-2', maxDelegatedSpend: '2500' };
  if (sc < 85) return { btier: 'BTIER-3', maxDelegatedSpend: '10000' };
  return { btier: 'BTIER-4', maxDelegatedSpend: '50000' };
}

/**
 * Enforce the aggregate delegation cap at allocation origination.
 *
 * Rule: allocatedTotal + requestedAllocation must be <= maxDelegatedSpend.
 * All values are treated as decimal strings (IOU-compatible, no float drift
 * introduced — we parse to Number which is safe for values < 2^53).
 */
export function delegationCapCheck(input: AggCapInput): AggCapResult {
  const cap = Number(input.maxDelegatedSpend);
  const allocated = Number(input.allocatedTotal);
  const requested = Number(input.requestedAllocation);
  const projected = allocated + requested;
  if (projected <= cap) return { allowed: true };
  return {
    allowed: false,
    reason: `projected allocation ${projected} would exceed operator maxDelegatedSpend ${cap}`,
  };
}
