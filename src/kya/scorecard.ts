// KYA signal aggregator — the bureau's internal underwriting model. The 100-point
// score is embedded as ONE field inside the on-ledger XLS-70 credential URI; it is
// never the headline product. Pure logic, no I/O. Weights are legible so the
// underwriting decision can be defended on stage.

export interface Signals {
  // Category A — agent behavioural (off-chain)
  worldId: boolean;
  runtimeStable: boolean;
  transcriptCoherent: boolean;
  sourceProvided: boolean;
  // Category B — on-chain XRPL financial behaviour
  accountAgeDays: number;
  rlusdPayments: number;
  escrowCompletionRate: number;
  priorPaymentSuccessRate: number;
  // Category C — human owner
  humanDidComplete: boolean;
  // Category D — accountability (KYB)
  /** A KYB-verified, legally accountable operator vouches for this agent. A genuine
   *  risk reducer (real principal behind the agent), not a self-reported metric. */
  operatorBacked?: boolean;
}

export type Tier = 'DENIED' | 'TIER-1' | 'TIER-2' | 'TIER-3' | 'TIER-4';
/** maxTxAmount = max single-payment value the trust credential vouches for. */
export interface Decision { score: number; tier: Tier; maxTxAmount: string; }

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** 0–100 creditworthiness score. */
export function score(s: Signals): number {
  let pts = 0;
  if (s.worldId) pts += 15;
  if (s.runtimeStable) pts += 10;
  if (s.transcriptCoherent) pts += 10;
  if (s.sourceProvided) pts += 5;
  pts += clamp01(Math.max(s.accountAgeDays, 0) / 30) * 10; // full at >=30 days
  pts += Math.min(Math.max(s.rlusdPayments, 0), 15);       // 1 pt/payment, cap 15
  pts += clamp01(s.escrowCompletionRate) * 15;
  pts += clamp01(s.priorPaymentSuccessRate) * 15;
  if (s.humanDidComplete) pts += 5;
  if (s.operatorBacked) pts += 10;
  return Math.round(Math.min(pts, 100));
}

export function tierFromScore(sc: number): Tier {
  if (sc < 30) return 'DENIED';
  if (sc < 50) return 'TIER-1';
  if (sc < 70) return 'TIER-2';
  if (sc < 85) return 'TIER-3';
  return 'TIER-4';
}

export function maxTxForTier(tier: Tier): string {
  switch (tier) {
    case 'DENIED': return '0';
    case 'TIER-1': return '25';
    case 'TIER-2': return '100';
    case 'TIER-3': return '500';
    case 'TIER-4': return '2000';
  }
}

/** Map a score to a trust tier and a max single-payment amount. */
export function decide(s: Signals): Decision {
  const sc = score(s);
  const tier = tierFromScore(sc);
  return { score: sc, tier, maxTxAmount: maxTxForTier(tier) };
}
