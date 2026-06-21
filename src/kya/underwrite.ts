// Combine off-chain KYA inputs + on-chain XRPL signals into a decision, a v2
// on-ledger credential payload (with code-attestation + operator link), and the
// content-addressed dossier that backs it.
import { type Client } from 'xrpl';
import { decide, type Signals, type Decision } from './scorecard.js';
import { readOnChainSignals } from './signals.js';
import { toRippleEpoch, type TrustTerms } from '../xrpl/codec.js';
import { type Attestation, prefix8 } from '../agent/attest.js';
import { buildDossier, type Dossier } from './dossier.js';

export interface UnderwriteResult { decision: Decision; terms: TrustTerms; signals: Signals; dossier: Dossier; }

const EMPTY: Signals = {
  worldId: false, runtimeStable: false, transcriptCoherent: false, sourceProvided: false,
  accountAgeDays: 0, rlusdPayments: 0, escrowCompletionRate: 0, priorPaymentSuccessRate: 0, humanDidComplete: false,
};

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
    version?: 1 | 2;
    now?: number; // injectable clock for deterministic tests
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

  const version = opts.version ?? 2;
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
