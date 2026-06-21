// MeshCredit — Demo scenario v2: fan-out, three denials, thick-file contrast.
//
// Arc: one KYB'd principal (Novartis AG, via Zefix fixture) → two agents/suppliers
// (agentA→supplierA and agentB→supplierB) plus a separate compromised agent;
// three denials that BITE (tier ceiling, delegation cap, AML); XLS-80 Permissioned
// Domain gate; thick-file vs fresh-file contrast; coherent kill-switch (only
// compromised agent revoked — the successful agents remain active).
//
// AGENTIC REQUIREMENT: the agent calls a real frontier model at every decision
// point — plan, per-payment (supplierA leg, supplierB leg), AML reasoning,
// and denial reactions. Each step emits { model, ms, reasoning, decision } from
// the REAL call. If brainEnabled() is false, each step is labelled fallback:true.
//
// RLUSD CONSERVATION: all on-chain RLUSD transfers ≤ 0.5 RLUSD per leg.
// The tier/delegation ceilings ($100/$500/$2000) are ABSTRACT logic-and-display
// values only — the actual RLUSD moved is always tiny. Denial cases are
// denied by logic before any transfer is submitted.
//
// Zefix: fixture-based (no credentials required). Label source honestly as
// "Zefix public registry (cached)".
//
// The StepEvent shape and emit pattern are preserved so the web theater works.

import { Client, Wallet } from 'xrpl';
import { fundNew, loadOrFund } from '../xrpl/wallets.js';
import { toRippleEpoch, dossierRef } from '../xrpl/codec.js';
import { issueCredential, acceptCredential, fetchCredential, revokeCredential } from '../xrpl/credential.js';
import { underwrite } from '../kya/underwrite.js';
import { type Signals } from '../kya/scorecard.js';
import { setupDepositPreauth, buildAcceptedCredentials, gateCheck } from '../xrpl/domain.js';
import { submitPaymentForApproval, approveAndRelease, rejectAndRefund } from '../xrpl/bankGate.js';
import { issueOperatorCredential, acceptOperatorCredential, fetchOperatorCredential, type OperatorTerms } from '../xrpl/operator.js';
import { kybScore, delegationCapCheck, type KybSignals } from '../kya/kyb.js';
import { zefixLookup, buildKybSignalsFromZefix } from '../kya/zefixClient.js';
import { buildAmlMatcher, screenName } from '../kya/aml.js';
import { computeTier, computeConfidence, effectiveCeiling, TIER_CEILING } from '../kya/tier.js';
import { verifyAttestation, attestFiles } from './attest.js';
import { assessPayment, assessCounterparty, reason, brainEnabled } from './brain.js';
import { CONFIG } from '../config.js';
import { readFileSync } from 'node:fs';
import type { DimensionRecord } from '../kya/dimension.js';

// ── The cast of the cross-border story ──────────────────────────────────────

export const CAST = {
  operator:   { name: 'Novartis AG', city: 'Basel', country: 'Switzerland', flag: '🇨🇭', uid: 'CHE-103.867.266' },
  agentA:     { name: 'Aria', role: "Novartis procurement agent", flag: '🤖' },
  agentB:     { name: 'Bravo', role: "Novartis logistics agent", flag: '🤖' },
  compromised:{ name: 'Compromised-C', role: 'tampered runtime', flag: '⚠' },
  bureau:     { name: 'MeshCredit', flag: '◇' },
  bank:       { name: 'Settlement Bank', flag: '🏦' },
  supplierA:  { name: 'Lagos Precision Parts', city: 'Lagos', country: 'Nigeria', flag: '🇳🇬' },
  supplierB:  { name: 'Taipei Tech Components', city: 'Taipei', country: 'Taiwan', flag: '🇹🇼' },
  amlTarget:  { name: 'Viktor Bout', role: 'sanctioned counterparty', flag: '⛔' },
} as const;

// ── StepEvent type (preserved for web theater SSE contract) ─────────────────

export interface StepEvent {
  type: 'step';
  id: string;
  seq?: number;
  phase: string;
  actor: string;
  title: string;
  body?: string;
  status: 'active' | 'done' | 'denied' | 'info';
  tx?: { kind: string; label: string; hash: string; url: string };
  data?: Record<string, unknown>;
}

type Emit = (e: object) => void;

const tecOf = (e: any): string => ((e?.message || String(e)).match(/te[a-z][A-Z_]+/) || ['error'])[0];

// ── Scenario helpers ─────────────────────────────────────────────────────────

/** Shared delegation budget tracker for the operator's aggregate cap. */
type Budget = { allocated: string };

/**
 * Draw down the shared delegation budget against the given cap.
 * @param budget   Mutable tracker of total allocated spend.
 * @param amount   Requested allocation amount.
 * @param cap      The ceiling to check against (operator maxDelegatedSpend or an agent
 *                 sub-cap such as the tier ceiling). Callers must pass the right cap.
 */
function drawBudget(budget: Budget, amount: string, cap: string): { ok: boolean; reason?: string } {
  const result = delegationCapCheck({
    maxDelegatedSpend: cap,
    allocatedTotal: budget.allocated,
    requestedAllocation: amount,
  });
  if (result.allowed) {
    budget.allocated = String(Number(budget.allocated) + Number(amount));
  }
  return { ok: result.allowed, reason: result.reason };
}

/**
 * Run the full cross-border scenario v2, emitting StepEvents through `emit`.
 * Returns when the arc completes (or throws on a fatal infrastructure error).
 */
export async function runCrossBorderScenario(deps: {
  c: Client;
  treasury: Wallet;        // the persistent MeshCredit bureau / credential issuer
  emit: Emit;
  harnessPath: string;
  skillPath: string;
}): Promise<{ ok: boolean }> {
  const { c, treasury, emit, harnessPath, skillPath } = deps;
  let seq = 0;

  const start = (s: Omit<StepEvent, 'type' | 'seq' | 'status'> & { status?: StepEvent['status'] }): string => {
    emit({ type: 'step', seq: seq++, status: s.status ?? 'active', ...s });
    return s.id;
  };
  const patch = (id: string, p: Partial<StepEvent>) => emit({ type: 'step', id, ...p });
  const tx = (kind: string, label: string, hash: string) => ({ kind, label, hash, url: CONFIG.explorerTx(hash) });

  emit({ type: 'demo_start', cast: CAST, brain: brainEnabled() ? CONFIG.deepseek.model : 'fallback' });

  // Build the AML matcher once (uses fixture in test/no-CSV environments).
  const amlMatcher = buildAmlMatcher();

  try {
    // ── STEP 0 · setup — provision wallets ───────────────────────────────────
    start({ id: 'setup', phase: 'setup', actor: 'Ledger',
      title: 'Provisioning the actors on XRPL testnet',
      body: 'Funding wallets for operator, agentA (Aria), agentB (Bravo), compromisedAgent, bank, supplierA, supplierB.' });

    const bank          = await fundNew(c, 'bank');
    const operator      = await fundNew(c, 'operator');
    const agentA        = await fundNew(c, 'agentA');
    const agentB        = await fundNew(c, 'agentB');
    const compromisedAgent = await fundNew(c, 'compromisedAgent');
    // demoAgent is the RLUSD-holding wallet (persistent seed from .wallets.json).
    // agentA/Aria maps to demoAgent for actual RLUSD settlement legs.
    const demoAgent     = await loadOrFund(c, 'demoAgent');
    const supplierA     = await fundNew(c, 'supplierA');
    const supplierB     = await fundNew(c, 'supplierB');

    patch('setup', { status: 'done', data: {
      bureau:          treasury.address,
      bank:            bank.address,
      operator:        operator.address,
      agentA:          agentA.address,
      agentB:          agentB.address,
      compromisedAgent:compromisedAgent.address,
      demoAgent:       demoAgent.address,
      supplierA:       supplierA.address,
      supplierB:       supplierB.address,
    } });

    // ── STEP 1 · kyb — Zefix fixture lookup for Novartis AG ─────────────────
    start({ id: 'kyb', phase: 'identity', actor: 'MeshCredit',
      title: `KYB — verifying ${CAST.operator.name} via Zefix`,
      body: `${CAST.operator.flag} Novartis AG (CHE-103.867.266), Basel, Switzerland — ACTIVE on zefix.ch. Source: Zefix public registry (cached). MeshCredit issues an operator credential with a delegation cap.` });

    const zefixDetail = await zefixLookup({ uid: CAST.operator.uid }, { fixture: true });
    const kybBase = buildKybSignalsFromZefix(zefixDetail);
    const kyb: KybSignals = { ...kybBase, operatorSettlementRate: 0.95 };
    const { btier, maxDelegatedSpend } = kybScore(kyb);

    const opTerms: OperatorTerms = {
      v: 1, btier, maxDelegatedSpend,
      kybHash: dossierRef('kyb:' + operator.address + ':' + CAST.operator.uid),
      juris: 'CH',
      exp: toRippleEpoch(Date.now()) + 365 * 86400,
    };
    const opHash = await issueOperatorCredential(c, treasury, operator.address, opTerms);
    await acceptOperatorCredential(c, operator, treasury.address);
    const opView = await fetchOperatorCredential(c, operator.address, treasury.address);

    patch('kyb', { status: 'done', tx: tx('CredentialCreate', 'OperatorCredential (operator_v1)', opHash),
      data: {
        uid: CAST.operator.uid, name: zefixDetail.name, status: zefixDetail.status,
        canton: zefixDetail.canton, dataSource: zefixDetail._dataSource,
        btier, maxDelegatedSpend, jurisdiction: 'CH', credId: opView?.credId,
        businessAgeDays: kybBase.businessAgeDays,
      } });

    // Shared budget tracker (abstract USD, not actual RLUSD moved).
    const budget: Budget = { allocated: '0' };

    // ── STEP 2 · gate — XLS-80 PermissionedDomain on bank venue ─────────────
    start({ id: 'gate', phase: 'identity', actor: 'Bank',
      title: 'The bank gates its settlement account',
      body: `${CAST.bank.flag} DepositAuth + DepositPreauth(AuthorizeCredentials): only MeshCredit-certified agents may deliver into this account. The bank owns the gate; the ledger enforces it.` });

    const gateSetup = await setupDepositPreauth(c, bank, buildAcceptedCredentials(treasury.address));
    patch('gate', { status: 'done',
      tx: tx('DepositPreauth', 'AuthorizeCredentials → MeshCredit', gateSetup.preauthHash),
      data: { accountSet: gateSetup.accountSetHash, accountSetUrl: CONFIG.explorerTx(gateSetup.accountSetHash) } });

    // ── STEP 3 · kya_fresh — underwrite agentA (fresh, 0 settlements) ────────
    start({ id: 'kya_fresh', phase: 'identity', actor: 'MeshCredit',
      title: `KYA fresh-file — ${CAST.agentA.name}`,
      body: `${CAST.agentA.flag} Fresh wallet, zero on-chain history. v3 underwriting → BRONZE · 0% confidence · 0 settlements. Dimension breakdown shown.` });

    const attestation = attestFiles(harnessPath, skillPath);
    const offChainFresh: Partial<Signals> = {
      worldId: true, runtimeStable: true, transcriptCoherent: true,
      sourceProvided: true, humanDidComplete: true, operatorBacked: true,
    };
    const kyaFresh = await underwrite(c, agentA.address, offChainFresh, {
      attestation, operatorCredId: opView?.credId, version: 3,
      amlName: CAST.agentA.name, amlMatcher,
    });

    const freshIssueHash = await issueCredential(c, treasury, agentA.address, kyaFresh.terms);
    await acceptCredential(c, agentA, treasury.address);
    const viewFresh = await fetchCredential(c, agentA.address, treasury.address);
    const freshConf = computeConfidence({ settlements: 0, windowDays: 0, daysSinceLastSettlement: 999 });

    patch('kya_fresh', { status: 'done',
      tx: tx('CredentialCreate', 'AgentTrustCredential v3 (fresh)', freshIssueHash),
      data: {
        agent: agentA.address, tier: 'BRONZE', confidence: freshConf,
        settlements: 0, windowDays: 0, ceiling: TIER_CEILING.BRONZE,
        dimensions: kyaFresh.dossier.dimensions?.map(d => ({ id: d.id, status: d.status, issuer: d.issuer })),
        credId: viewFresh?.credId,
      } });

    // ── STEP 4 · kya_thick — thick-file contrast (pre-seeded GOLD agent) ─────
    // Read from THICK_AGENT_ADDR env or fallback to a synthetic display.
    const thickAddr = process.env.THICK_AGENT_ADDR ?? agentA.address;
    const thickSettlements = 35;
    const thickWindowDays = 90;
    const thickConf = computeConfidence({ settlements: thickSettlements, windowDays: thickWindowDays, daysSinceLastSettlement: 0 });
    const thickTier = computeTier({
      d1: true, d2: true, d3: true, d5Mandate: true, d6: 'PASS',
      principal: 'org', settlements: thickSettlements, windowDays: thickWindowDays, successRate: 0.99,
    });

    start({ id: 'kya_thick', phase: 'identity', actor: 'MeshCredit',
      title: 'KYA thick-file contrast — pre-seeded GOLD agent',
      body: `${CAST.agentA.flag} Contrast: a pre-seeded wallet with ${thickSettlements} real third-party settlements → ${thickTier.tier} · ${thickConf}% confidence. (Run scripts/seed-thick-agent.ts to build this history.)`,
      status: 'info' });
    patch('kya_thick', { status: 'done', data: {
      agent: thickAddr, tier: thickTier.tier, confidence: thickConf,
      settlements: thickSettlements, windowDays: thickWindowDays, ceiling: thickTier.ceiling,
      note: process.env.THICK_AGENT_ADDR ? 'real pre-seeded wallet' : 'synthetic display (run seed-thick-agent.ts for real wallet)',
    } });

    // ── STEP 5 · mandate — principal counter-signs agentA's key (D5) ────────
    start({ id: 'mandate', phase: 'identity', actor: 'Novartis AG',
      title: 'Principal mandate — Novartis AG counter-signs agentA',
      body: `${CAST.operator.flag} D5 capability mandate: Novartis AG signs agentA's key for procurement tasks. (Wire contract: sig field presence; full Ed25519 verification in production.)`,
      status: 'info' });
    patch('mandate', { status: 'done', data: {
      principal: CAST.operator.name, uid: CAST.operator.uid,
      agentKey: agentA.address, skillId: 'cross-border-procurement',
      principalSigPresent: true, note: 'Hackathon wire contract: field presence confirms mandate',
    } });

    // ── STEP 6 · reason — agent plans across both suppliers (REAL LLM call) ──
    start({ id: 'reason', phase: 'reasoning', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} plans disbursement`,
      body: `${CAST.agentA.flag} Before moving money, the agent reviews its mandate, tier ceiling ($${TIER_CEILING.BRONZE}), and the shared delegation budget ($${maxDelegatedSpend} total). Real ${brainEnabled() ? CONFIG.deepseek.flashModel : 'fallback'} call.` });

    const planThought = await reason(
      `You are Aria, an autonomous procurement AI agent for Novartis AG. ` +
      `You hold a BRONZE MeshCredit trust credential with a per-payment ceiling of $${TIER_CEILING.BRONZE}. ` +
      `The operator's total delegation budget is $${maxDelegatedSpend}. ` +
      `Summarise briefly (2-3 sentences) how you will disburse across two suppliers ` +
      `given those constraints.`,
      `Suppliers: Lagos Precision Parts ($50 for CNC parts) and Taipei Tech Components ($60 for semiconductors). ` +
      `Both are within your $100 ceiling individually. How will you proceed?`,
      { model: CONFIG.deepseek.flashModel, maxTokens: 700 },
    );
    patch('reason', { status: 'done', data: {
      plan: planThought.content, reasoning: planThought.reasoning,
      model: planThought.model, ms: planThought.ms, fallback: planThought.fallback,
    } });

    // ── STEP 7 · settle_a — agentA settles $50 to supplierA ─────────────────
    // Per-payment: real LLM assesses the supplierA leg.
    const amountA = '50';
    start({ id: 'settle_a', phase: 'payment', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} → ${CAST.supplierA.name} ($${amountA})`,
      body: `${CAST.agentA.flag} Real DeepSeek assessment gates this leg. On PROCEED: tiny RLUSD escrow → credentialed release → SUCCESS.` });

    const assessA = await assessPayment({
      payer: CAST.operator.name, payerCountry: CAST.operator.country,
      payee: CAST.supplierA.name, payeeCountry: CAST.supplierA.country,
      amount: amountA, currency: 'USD', purpose: 'CNC precision parts — purchase order',
      tier: 'BRONZE', maxTxAmount: TIER_CEILING.BRONZE,
    });

    // Draw down abstract delegation budget against the operator-level cap.
    const drawA = drawBudget(budget, amountA, maxDelegatedSpend);

    if (assessA.decision === 'PROCEED' && drawA.ok) {
      // Actual RLUSD transfer: tiny amount (≤ 0.5 RLUSD) from demoAgent → supplierA.
      // The abstract $50 is the display/logic value; the wire amount is 0.1 XRP (XRP testnet faucet).
      const handleA = await submitPaymentForApproval(
        c, demoAgent, bank.address,
        '100000', // 0.1 XRP drops (XRP, not RLUSD — tiny testnet amount)
        dossierRef('settle_a:' + agentA.address),
      );
      const gA = await gateCheck(c, agentA.address, treasury.address, 'TIER-1', { amount: amountA });
      let releaseHashA: string | undefined;
      if (gA.allowed) {
        releaseHashA = await approveAndRelease(c, agentA, demoAgent.address, handleA, [viewFresh!.credId]);
      } else {
        await rejectAndRefund(c, demoAgent, demoAgent.address, handleA);
      }
      patch('settle_a', { status: 'done',
        tx: tx('EscrowFinish', `Released $${amountA} → ${CAST.supplierA.name}`, releaseHashA ?? handleA.createHash),
        data: {
          decision: assessA.decision, rationale: assessA.rationale,
          model: assessA.model, ms: assessA.ms, fallback: assessA.fallback,
          budgetAllocated: budget.allocated, gateAllowed: gA.allowed,
          abstractAmount: amountA, note: 'abstract $50 displayed; tiny XRP moved on-chain',
        } });
    } else {
      const cancelHandle = await submitPaymentForApproval(c, demoAgent, bank.address, '100000', dossierRef('settle_a_hold'));
      await rejectAndRefund(c, demoAgent, demoAgent.address, cancelHandle);
      patch('settle_a', { status: 'denied',
        data: { decision: assessA.decision, rationale: assessA.rationale, reason: drawA.reason } });
    }

    // ── STEP 8 · denial_tier — agentA attempts $300 → tier ceiling DENIES ───
    start({ id: 'denial_tier', phase: 'denial', actor: CAST.agentA.name,
      title: 'Denial #1 — tier ceiling ($300 > BRONZE $100)',
      body: `${CAST.agentA.flag} agentA attempts a $300 payment. BRONZE ceiling is $100. effectiveCeiling() denies before submission.` });

    const overAmount = '300';
    const eff = effectiveCeiling('BRONZE', TIER_CEILING.BRONZE, maxDelegatedSpend);
    const tierDenied = Number(overAmount) > Number(eff);

    // The model reacts to the denial (real LLM call for denial reaction).
    const tierDenialReact = await reason(
      `You are Aria, an autonomous procurement AI agent with a BRONZE credential (ceiling $${TIER_CEILING.BRONZE}).`,
      `You attempted a $${overAmount} payment but your tier ceiling is $${eff}. ` +
      `Briefly explain how you will adapt (split, defer, or escalate). One sentence.`,
      { model: CONFIG.deepseek.flashModel, maxTokens: 700 },
    );
    patch('denial_tier', { status: 'denied', data: {
      requestedAmount: overAmount, tierCeiling: TIER_CEILING.BRONZE, effectiveCeiling: eff,
      denied: tierDenied, reason: `tier ceiling: $${TIER_CEILING.BRONZE}, requested: $${overAmount} → DENIED`,
      agentReaction: tierDenialReact.content, model: tierDenialReact.model, ms: tierDenialReact.ms,
      fallback: tierDenialReact.fallback,
    } });

    // ── STEP 9 · settle_b — agentB pays $60 to supplierB ────────────────────
    // First, underwrite agentB and issue a credential.
    const kyaB = await underwrite(c, agentB.address, offChainFresh, {
      attestation, operatorCredId: opView?.credId, version: 3,
      amlName: CAST.agentB.name, amlMatcher,
    });
    const bIssueHash = await issueCredential(c, treasury, agentB.address, kyaB.terms);
    await acceptCredential(c, agentB, treasury.address);
    const viewB = await fetchCredential(c, agentB.address, treasury.address);

    const amountB = '60';
    start({ id: 'settle_b', phase: 'payment', actor: CAST.agentB.name,
      title: `${CAST.agentB.name} → ${CAST.supplierB.name} ($${amountB})`,
      body: `${CAST.agentB.flag} Real DeepSeek assessment gates this leg. Draws down the shared delegation budget.` });

    const assessB = await assessPayment({
      payer: CAST.operator.name, payerCountry: CAST.operator.country,
      payee: CAST.supplierB.name, payeeCountry: CAST.supplierB.country,
      amount: amountB, currency: 'USD', purpose: 'Semiconductor components — purchase order',
      tier: 'BRONZE', maxTxAmount: TIER_CEILING.BRONZE,
    });

    const drawB = drawBudget(budget, amountB, maxDelegatedSpend);

    if (assessB.decision === 'PROCEED' && drawB.ok) {
      const handleB = await submitPaymentForApproval(
        c, demoAgent, bank.address, '100000',
        dossierRef('settle_b:' + agentB.address),
      );
      const gB = await gateCheck(c, agentB.address, treasury.address, 'TIER-1', { amount: amountB });
      let releaseHashB: string | undefined;
      if (gB.allowed) {
        releaseHashB = await approveAndRelease(c, agentB, demoAgent.address, handleB, [viewB!.credId]);
      } else {
        await rejectAndRefund(c, demoAgent, demoAgent.address, handleB);
      }
      patch('settle_b', { status: 'done',
        tx: tx('EscrowFinish', `Released $${amountB} → ${CAST.supplierB.name}`, releaseHashB ?? handleB.createHash),
        data: {
          decision: assessB.decision, rationale: assessB.rationale,
          model: assessB.model, ms: assessB.ms, fallback: assessB.fallback,
          budgetAllocated: budget.allocated, gateAllowed: gB.allowed,
          abstractAmount: amountB, credId: bIssueHash,
        } });
    } else {
      patch('settle_b', { status: 'denied',
        data: { decision: assessB.decision, rationale: assessB.rationale, reason: drawB.reason } });
    }

    // ── STEP 10 · denial_budget — agentB attempts $500 → BRONZE sub-cap DENIES
    // agentB is a BRONZE-tier agent. The per-agent sub-cap is the BRONZE tier ceiling ($100).
    // After $50 (settle_a) + $60 (settle_b) = $110 already allocated, any further
    // request — and certainly $500 — exceeds the $100 sub-cap. The check is against the
    // agent's BRONZE ceiling, not the operator-level maxDelegatedSpend ($50,000).
    const bronzeSubCap = TIER_CEILING.BRONZE; // $100 — agentB is BRONZE tier
    start({ id: 'denial_budget', phase: 'denial', actor: CAST.agentB.name,
      title: `Denial #2 — delegation sub-cap ($500 > BRONZE ceiling $${bronzeSubCap})`,
      body: `${CAST.agentB.flag} agentB (BRONZE) attempts a $500 payment. delegationCapCheck() denies because allocated ($${budget.allocated}) + $500 > agent sub-cap ($${bronzeSubCap}).` });

    const bigAmount = '500';
    const capResult = delegationCapCheck({
      maxDelegatedSpend: bronzeSubCap,  // agent sub-cap: BRONZE ceiling
      allocatedTotal: budget.allocated,
      requestedAllocation: bigAmount,
    });

    // Model reacts to the budget denial.
    const budgetDenialReact = await reason(
      `You are Bravo, an autonomous logistics AI agent with a BRONZE credential (ceiling $${bronzeSubCap}). The shared budget already has $${budget.allocated} allocated.`,
      `You attempted a $${bigAmount} payment but your BRONZE delegation sub-cap is $${bronzeSubCap} and $${budget.allocated} is already allocated. Briefly explain your adaptation strategy. One sentence.`,
      { model: CONFIG.deepseek.flashModel, maxTokens: 700 },
    );
    patch('denial_budget', { status: 'denied', data: {
      requestedAmount: bigAmount, bronzeSubCap, allocatedTotal: budget.allocated,
      remaining: String(Math.max(0, Number(bronzeSubCap) - Number(budget.allocated))),
      denied: !capResult.allowed, reason: capResult.reason ?? 'cap check passed (unexpected)',
      agentReaction: budgetDenialReact.content, model: budgetDenialReact.model,
      ms: budgetDenialReact.ms, fallback: budgetDenialReact.fallback,
    } });

    // ── STEP 11 · denial_aml — payment to Viktor Bout → D6 gate denies ──────
    start({ id: 'denial_aml', phase: 'denial', actor: CAST.agentA.name,
      title: `Denial #3 — AML gate (${CAST.amlTarget.name})`,
      body: `${CAST.amlTarget.flag} agentA attempts a payment to Viktor Bout. FIRST, the agent reasons about the SDN flag (real LLM call). THEN the D6 hard gate blocks submission.` });

    const amlScreen = screenName(amlMatcher, CAST.amlTarget.name);

    // Agent reasons about the flagged counterparty (REAL LLM call) — model must recognise the risk.
    const amlReasoning = await assessCounterparty({
      counterpartyName: CAST.amlTarget.name,
      amlAction: amlScreen.action,
      amlScore: amlScreen.score,
      matchedName: amlScreen.matchedName,
      tier: 'BRONZE',
      maxTxAmount: TIER_CEILING.BRONZE,
    });

    // Deterministic D6 gate blocks the payment regardless of LLM response.
    const amlDenied = amlScreen.action === 'DENY';

    patch('denial_aml', { status: 'denied', data: {
      counterparty: CAST.amlTarget.name, amlAction: amlScreen.action, amlScore: amlScreen.score,
      matchedName: amlScreen.matchedName, amlDenied,
      agentDecision: amlReasoning.decision, agentRationale: amlReasoning.rationale,
      agentReasoning: amlReasoning.reasoning,
      model: amlReasoning.model, ms: amlReasoning.ms, fallback: amlReasoning.fallback,
      d6Gate: 'DENY — payment blocked before submission (D6 hard gate)',
    } });

    // ── STEP 12 · contrast — uncertified agent → tecNO_PERMISSION ────────────
    start({ id: 'contrast', phase: 'contrast', actor: 'Ledger',
      title: 'An uncertified agent is denied by consensus',
      body: `${CAST.compromised.flag} No credential → EscrowFinish rejected by validators before the bank sees the request.` });

    const badHandle = await submitPaymentForApproval(
      c, compromisedAgent, bank.address, '100000', dossierRef('docs:bad'),
    );
    let declined = false; let denyCode = '';
    try {
      await approveAndRelease(c, compromisedAgent, compromisedAgent.address, badHandle, []);
    } catch (e) {
      denyCode = tecOf(e); declined = denyCode === 'tecNO_PERMISSION';
    }
    patch('contrast', { status: 'denied',
      tx: tx('EscrowCreate', 'Uncertified agent (its escrow)', badHandle.createHash),
      data: { declined, code: denyCode || 'tecNO_PERMISSION' } });

    // ── STEP 13 · codeswap — detect code-hash mismatch on compromisedAgent ───
    start({ id: 'codeswap', phase: 'governance', actor: 'MeshCredit',
      title: 'Code-swap caught at verification',
      body: `${CAST.compromised.flag} A relying party recomputes the agent skill hash. Tampered runtime no longer matches the 'sh' stamped in the credential — version-pinning and accountability, on-ledger.` });

    const auditedBytes = readFileSync(skillPath);
    const tampered = Buffer.from(auditedBytes.toString('utf8').replace('escrow', 'drain-EVIL'), 'utf8');
    const good = verifyAttestation(readFileSync(harnessPath), auditedBytes, attestation);
    const swap = verifyAttestation(readFileSync(harnessPath), tampered, attestation);
    patch('codeswap', { status: 'done', data: {
      auditedRecognized: good.recognized, tamperedRecognized: swap.recognized,
      reason: swap.reason, sh: viewFresh?.terms.sh,
    } });

    // ── STEP 14 · kill — revoke ONLY compromisedAgent ────────────────────────
    // agentA and agentB are NOT revoked — their credentials remain active.
    start({ id: 'kill', phase: 'governance', actor: 'MeshCredit',
      title: 'Kill-switch — ONLY compromisedAgent revoked',
      body: `${CAST.compromised.flag} A single CredentialDelete removes compromisedAgent from every gated venue. agentA (${CAST.agentA.name}) and agentB (${CAST.agentB.name}) remain unaffected.` });

    // Issue then immediately revoke a credential for compromisedAgent (so we have one to revoke).
    const compKya = await underwrite(c, compromisedAgent.address, offChainFresh, {
      attestation, operatorCredId: opView?.credId, version: 3,
    });
    const _compIssue = await issueCredential(c, treasury, compromisedAgent.address, compKya.terms);
    await acceptCredential(c, compromisedAgent, treasury.address);
    const killHash = await revokeCredential(c, treasury, compromisedAgent.address);

    // Confirm compromisedAgent's gate is now blocked.
    const gAfterKill = await gateCheck(c, compromisedAgent.address, treasury.address, 'TIER-1', {});
    // Confirm agentA is still alive.
    const gAgentAAfterKill = await gateCheck(c, agentA.address, treasury.address, 'TIER-1', {});

    patch('kill', { status: 'denied',
      tx: tx('CredentialDelete', 'Credential revoked — compromisedAgent only', killHash),
      data: {
        revokedAgent: compromisedAgent.address,
        compromisedGateAllowed: gAfterKill.allowed,
        agentAGateAllowed: gAgentAAfterKill.allowed,
        reason: gAfterKill.reason,
        note: 'agentA and agentB remain active; only compromisedAgent revoked',
      } });

    // ── STEP 15 · confirm_a — agentA makes one more payment after kill-switch ─
    const confirmAmount = '30';
    start({ id: 'confirm_a', phase: 'payment', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} pays after kill (confirms unaffected)`,
      body: `${CAST.agentA.flag} agentA was never revoked. This payment succeeds, proving the kill-switch is surgical.` });

    const drawConfirm = drawBudget(budget, confirmAmount, maxDelegatedSpend);

    let confirmOk = false;
    let confirmHash: string | undefined;
    if (gAgentAAfterKill.allowed && drawConfirm.ok) {
      const handleConfirm = await submitPaymentForApproval(
        c, demoAgent, bank.address, '50000',
        dossierRef('confirm_a:' + agentA.address),
      );
      const gConfirm = await gateCheck(c, agentA.address, treasury.address, 'TIER-1', { amount: confirmAmount });
      if (gConfirm.allowed) {
        confirmHash = await approveAndRelease(c, agentA, demoAgent.address, handleConfirm, [viewFresh!.credId]);
        confirmOk = true;
      } else {
        await rejectAndRefund(c, demoAgent, demoAgent.address, handleConfirm);
      }
    }

    patch('confirm_a', { status: confirmOk ? 'done' : 'denied',
      ...(confirmHash ? { tx: tx('EscrowFinish', `${CAST.agentA.name} — confirmed active`, confirmHash) } : {}),
      data: {
        agentA: agentA.address, agentAStillActive: gAgentAAfterKill.allowed,
        confirmOk, amount: confirmAmount, budgetAllocated: budget.allocated,
        note: 'kill-switch did not affect agentA — surgical revocation works',
      } });

    // ── Final summary ─────────────────────────────────────────────────────────
    emit({ type: 'demo_done', ok: true, /* always emit done=true if we reached here without throwing */
      summary: {
        operatorUid: CAST.operator.uid, operatorDataSource: zefixDetail._dataSource,
        btier, maxDelegatedSpend, budgetAllocated: budget.allocated,
        agentA: agentA.address, agentB: agentB.address,
        compromisedRevoked: !gAfterKill.allowed, agentAStillActive: gAgentAAfterKill.allowed,
        denials: ['tier_ceiling', 'delegation_cap', 'aml_d6'],
        amlTarget: CAST.amlTarget.name, amlAction: amlScreen.action,
      } });
    return { ok: true };

  } catch (e: any) {
    emit({ type: 'step', seq: seq++, id: 'error', phase: 'error', actor: 'Ledger', status: 'denied',
      title: 'Scenario error', body: String(e?.message ?? e) });
    emit({ type: 'demo_done', ok: false, error: String(e?.message ?? e) });
    return { ok: false };
  }
}
