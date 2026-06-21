// Combine off-chain KYA inputs + on-chain XRPL signals into a decision, a v2/v3
// on-ledger credential payload (with code-attestation + operator link), and the
// content-addressed dossier that backs it.
import { type Client } from 'xrpl';
import { decide, type Signals, type Decision } from './scorecard.js';
import { readOnChainSignals } from './signals.js';
import { toRippleEpoch, type TrustTerms } from '../xrpl/codec.js';
import { type Attestation, prefix8 } from '../agent/attest.js';
import { buildDossier, type Dossier } from './dossier.js';
import { computeTier, computeConfidence, type TierInput } from './tier.js';
import { dimsBitmask, buildDimensionRecord, type DimensionRecord } from './dimension.js';
import type { MandateRecord } from './dimension.js';
import type { ScreeningResult } from './aml.js';

export interface UnderwriteResult { decision: Decision; terms: TrustTerms; signals: Signals; dossier: Dossier; }

const EMPTY: Signals = {
  worldId: false, runtimeStable: false, transcriptCoherent: false, sourceProvided: false,
  accountAgeDays: 0, rlusdPayments: 0, escrowCompletionRate: 0, priorPaymentSuccessRate: 0, humanDidComplete: false,
};

/** Derive a 12-hex content hash prefix from the dossier ref (fits v3 wire format). */
function contentHashFrom(dossierRef: string): string {
  return dossierRef.slice(0, 12);
}

/** Build the 6 DimensionRecords for v3 based on available signals. */
function buildV3Dimensions(signals: Signals, opts: {
  now: number;
  d5Mandate?: MandateRecord | boolean;
  settlements?: number;
  amlResult?: ScreeningResult;
}): DimensionRecord[] {
  const now = opts.now;

  // D1 — Principal identity: operatorBacked or worldId implies some identity check
  const d1Pass = !!(signals.operatorBacked || signals.worldId);
  const d1: DimensionRecord = buildDimensionRecord('D1', {
    status: d1Pass ? 'PASS' : 'PENDING',
    issuer: signals.operatorBacked ? 'KYB Registry' : 'World ID',
    evidenceRef: signals.operatorBacked ? 'operator-backed' : (signals.worldId ? 'worldid-claim' : 'none'),
    evidenceHash: signals.operatorBacked ? '0'.repeat(64) : '1'.repeat(64),
    details: { operatorBacked: !!signals.operatorBacked, worldId: !!signals.worldId },
    checkedAt: now,
  });

  // D2 — Human accountability (World ID)
  const d2Pass = !!signals.worldId;
  const d2: DimensionRecord = buildDimensionRecord('D2', {
    status: d2Pass ? 'PASS' : 'PENDING',
    issuer: 'World ID',
    evidenceRef: d2Pass ? 'worldid-claim' : 'none',
    evidenceHash: d2Pass ? 'a'.repeat(64) : '0'.repeat(64),
    details: { worldId: d2Pass },
    checkedAt: now,
  });

  // D3 — Code provenance (runtimeStable = hash provided and matches)
  const d3Pass = !!signals.runtimeStable;
  const d3: DimensionRecord = buildDimensionRecord('D3', {
    status: d3Pass ? 'PASS' : 'FAIL',
    issuer: 'Runtime Attestation',
    evidenceRef: d3Pass ? 'runtime-hash' : 'none',
    evidenceHash: d3Pass ? 'b'.repeat(64) : '0'.repeat(64),
    details: { runtimeStable: d3Pass, transcriptCoherent: !!signals.transcriptCoherent },
    checkedAt: now,
  });

  // D4 — On-chain behavioral record (third-party settlements)
  const settlements = opts.settlements ?? signals.rlusdPayments ?? 0;
  const d4Pass = settlements > 0;
  const d4: DimensionRecord = buildDimensionRecord('D4', {
    status: d4Pass ? 'PASS' : 'PENDING',
    issuer: 'Public XRPL',
    evidenceRef: d4Pass ? `${settlements}-settlements` : 'none',
    evidenceHash: 'c'.repeat(64),
    details: { thirdPartySettlements: settlements },
    checkedAt: now,
  });

  // D5 — Capability mandate (principal-signed)
  const d5Pass = !!(opts.d5Mandate);
  const d5: DimensionRecord = buildDimensionRecord('D5', {
    status: d5Pass ? 'PASS' : 'PENDING',
    issuer: 'Principal',
    evidenceRef: d5Pass ? 'mandate-present' : 'none',
    evidenceHash: 'd'.repeat(64),
    details: { mandatePresent: d5Pass },
    checkedAt: now,
  });

  // D6 — AML/compliance: use supplied amlResult if provided, else default PASS
  const amlResult = opts.amlResult;
  const d6Status = amlResult
    ? (amlResult.action === 'DENY' ? 'FAIL' : amlResult.action === 'REVIEW' ? 'PENDING' : 'PASS')
    : 'PASS';
  const d6: DimensionRecord = buildDimensionRecord('D6', {
    status: d6Status,
    issuer: 'OFAC SDN',
    evidenceRef: amlResult ? (amlResult.hit ? `hit:${amlResult.matchedName}` : 'no-hit') : 'no-hit',
    evidenceHash: 'e'.repeat(64),
    details: {
      action: amlResult?.action ?? 'PASS',
      provider: amlResult ? 'opensanctions' : 'default',
      ...(amlResult?.matchedName ? { matchedName: amlResult.matchedName } : {}),
      ...(amlResult?.score !== undefined ? { score: amlResult.score } : {}),
    },
    checkedAt: now,
  });

  return [d1, d2, d3, d4, d5, d6];
}

export async function underwrite(
  c: Client,
  agentAddr: string,
  offChain: Partial<Signals> = {},
  opts: {
    // PRODUCTION-GATED: priorPaymentSuccessRate is caller-injectable here for demos.
    // In production it MUST come from a bureau-attested settlement record, never the
    // caller — do not use it to lift tiers (the honest TIER-floor lever is operatorBacked).
    priorPaymentSuccessRate?: number;
    kyaSeed?: string; // DEPRECATED: no longer affects ref (ref is now the dossier content hash). Accepted for caller back-compat; ignored.
    attestation?: Attestation;
    operatorCredId?: string;
    version?: 1 | 2 | 3;
    now?: number; // injectable clock for deterministic tests
    // v3 underwriting inputs (ignored in v1/v2)
    d5Mandate?: MandateRecord | boolean;
    settlements?: number;       // third-party clean settlement count (D4)
    windowDays?: number;        // observation window in days
    successRate?: number;       // 0..1 escrow/payment success rate
    cleanStreakDays?: number;   // consecutive clean days
    operatorBtier?: string;     // e.g. 'BTIER-3'
    /** AML screening result (Task 8 deliverable: flows into D6 dimension + dossier). */
    amlResult?: ScreeningResult;
  } = {},
): Promise<UnderwriteResult> {
  const onChain = await readOnChainSignals(c, agentAddr);
  const signals: Signals = {
    ...EMPTY,
    priorPaymentSuccessRate: opts.priorPaymentSuccessRate ?? 0,
    ...onChain,
    ...offChain, // explicit off-chain KYA inputs win (e.g., World ID, operatorBacked)
  };
  const decision = decide(signals);
  const now = opts.now ?? Date.now();
  const exp = toRippleEpoch(now) + 30 * 24 * 3600;
  const att = opts.attestation;

  const version = opts.version ?? 2;

  if (version === 3) {
    // ── v3 path: tier+confidence engine ───────────────────────────────────────
    const dims = buildV3Dimensions(signals, { now, d5Mandate: opts.d5Mandate, settlements: opts.settlements, amlResult: opts.amlResult });
    const mask = dimsBitmask(dims);

    const settlements = opts.settlements ?? signals.rlusdPayments ?? 0;
    const windowDays = opts.windowDays ?? 0;

    const tierInput: TierInput = {
      d1: dims.find(d => d.id === 'D1')?.status === 'PASS',
      d2: dims.find(d => d.id === 'D2')?.status === 'PASS',
      d3: dims.find(d => d.id === 'D3')?.status === 'PASS',
      d5Mandate: dims.find(d => d.id === 'D5')?.status === 'PASS',
      // Derive d6 directly from the AML action so REVIEW is preserved and not collapsed
      // to 'FAIL' (which would incorrectly trigger DENIED in tier.ts line 77).
      d6: opts.amlResult
        ? (opts.amlResult.action === 'DENY' ? 'DENY' : opts.amlResult.action === 'REVIEW' ? 'REVIEW' : 'PASS')
        : 'PASS',
      principal: signals.operatorBacked ? 'org' : (signals.worldId ? 'individual' : 'pseudonymous'),
      settlements,
      windowDays,
      successRate: opts.successRate,
      cleanStreakDays: opts.cleanStreakDays,
      operatorBtier: opts.operatorBtier,
    };

    const tierResult = computeTier(tierInput);
    const confidence = computeConfidence({
      settlements,
      windowDays,
      daysSinceLastSettlement: 0, // conservative default
    });

    // Build screening record from AML result if provided.
    const amlRes = opts.amlResult;
    const screening = amlRes
      ? { sanctions: amlRes.action === 'DENY' ? 'hit' : 'clear' as 'hit' | 'clear', pep: 'clear' as const, provider: 'opensanctions' }
      : { sanctions: 'clear' as const, pep: 'clear' as const, provider: 'default' };

    const dossier = buildDossier({
      agentAddr,
      operatorCredId: opts.operatorCredId,
      harnessHashFull: att?.harnessHashFull ?? '',
      skillHashFull: att?.skillHashFull ?? '',
      score: decision.score,
      tier: tierResult.tier,
      signals,
      screening,
      dimensions: dims,
      ...(amlRes ? { amlResult: amlRes } : {}),
      createdAt: now,
    });

    const disposition = tierResult.tier === 'DENIED' ? 'D' : 'A';
    const terms: TrustTerms = {
      v: 3,
      tier: tierResult.tier,
      maxTxAmount: tierResult.ceiling,
      confidence,
      dimsBitmask: mask,
      exp,
      contentHash: contentHashFrom(dossier.ref),
      disposition,
      ...(att ? { ih: att.ih, sh: att.sh } : {}),
      ...(opts.operatorCredId ? { op: prefix8(opts.operatorCredId) } : {}),
    };

    return { decision, terms, signals, dossier };
  }

  // ── v1 / v2 path (unchanged) ─────────────────────────────────────────────
  const dossier = buildDossier({
    agentAddr,
    operatorCredId: opts.operatorCredId,
    harnessHashFull: att?.harnessHashFull ?? '',
    skillHashFull: att?.skillHashFull ?? '',
    score: decision.score,
    tier: decision.tier,
    signals,
    screening: { sanctions: 'stub', pep: 'stub', provider: 'demo-stub' },
    createdAt: now,
  });

  const terms: TrustTerms = version === 2
    ? {
        v: 2, tier: decision.tier, maxTxAmount: decision.maxTxAmount, score: decision.score, exp,
        ref: dossier.ref,
        disposition: decision.tier === 'DENIED' ? 'D' : 'A',
        ...(att ? { ih: att.ih, sh: att.sh } : {}),
        ...(opts.operatorCredId ? { op: prefix8(opts.operatorCredId) } : {}),
      }
    : { v: 1, tier: decision.tier, maxTxAmount: decision.maxTxAmount, score: decision.score, exp, ref: dossier.ref };

  return { decision, terms, signals, dossier };
}
