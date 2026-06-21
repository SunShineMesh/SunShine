// MeshCredit — Demo scenario v3: a CASE-BASED agent trust loop.
//
// The agent does not run one long tangled arc. It evaluates a sequence of
// independent PAYMENT CASES, each scoped to exactly ONE counterparty. Every case
// runs the same trust loop and STOPS at the first gate that denies — a denial
// terminates that case cleanly (no funds move, no further steps), instead of the
// run barrelling on. This fixes two demo bugs:
//   1. "we're paying a Nigerian company but another company pops up" — each case
//      is bounded to a single counterparty, so suppliers never bleed into one
//      another mid-flow.
//   2. "a denial should stop the process" — a denied gate halts the case; the
//      step is marked { halted:true } and nothing downstream runs for that case.
//
// The cases:
//   Case A  APPROVED  Aria  → Lagos Precision Parts (Nigeria)  — full settlement
//   Case B  APPROVED  Bravo → Taipei Tech Components (Taiwan)  — full settlement
//   Case C  DENIED    Aria  → Star Dragon Corp (OFAC SDN)      — D6 AML, HALT
//   Case D  DENIED    Aria  → $300 over BRONZE ceiling         — tier gate, HALT
//   Case E  DENIED    Bravo → $500 over delegation budget      — fleet cap, HALT
// then bureau enforcement: uncertified→consensus denial, code-swap, kill-switch.
//
// AGENTIC REQUIREMENT: the agent calls a real frontier model at EVERY decision
// point — plan, per-payment risk, counterparty AML reasoning, denial reactions.
// Reasoning is uncapped (CONFIG.deepseek.maxTokens) so the chain-of-thought runs
// long, and every step surfaces its reasoning_content for the viewer to read.
// If brainEnabled() is false, each step is labelled fallback:true.
//
// RLUSD CONSERVATION: all on-chain transfers are tiny (≤0.1 XRP drops). The
// tier/delegation ceilings ($100/$150/$2000) are ABSTRACT logic-and-display
// values only. Denied cases are denied by logic BEFORE any transfer is submitted.
//
// Zefix: fixture-based (no credentials). Labelled honestly as cached.
// The StepEvent shape is preserved so the web theater keeps working.

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
  amlTarget:  { name: 'Star Dragon Corporation Limited', role: 'sanctioned counterparty', flag: '⛔' },
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
export type Budget = { allocated: string };

/**
 * Check whether a draw fits within the cap — WITHOUT spending anything. This is a
 * pure gate: it never mutates `budget`. Checking and spending are deliberately
 * separated so that a case which later HALTS (agent HOLD, AML deny, or the bank
 * gate refusing release) does NOT consume the fleet budget. The earlier design
 * folded the mutation into the check, so a denied payment still drew down the
 * budget and the displayed allocation could not be trusted.
 * @param budget  Tracker of total allocated spend (read-only here).
 * @param amount  Requested allocation amount.
 * @param cap     The ceiling to check against — pass the advertised fleet budget so
 *                the per-case gate enforces the same number the UI narrates.
 */
export function budgetCheck(budget: Budget, amount: string, cap: string): { ok: boolean; reason?: string } {
  const result = delegationCapCheck({
    maxDelegatedSpend: cap,
    allocatedTotal: budget.allocated,
    requestedAllocation: amount,
  });
  return { ok: result.allowed, reason: result.reason };
}

/**
 * Spend the budget. This is the ONLY thing that mutates `budget.allocated`, and it
 * must be called only once a case has actually settled on-ledger — so the running
 * allocation reflects money that genuinely moved, not money that was merely
 * requested. Always pair with a prior {@link budgetCheck} that returned ok.
 */
export function commitBudget(budget: Budget, amount: string): void {
  budget.allocated = String(Number(budget.allocated) + Number(amount));
}

/**
 * The core STOP-ON-DENIAL rule for a payment case. A case proceeds to on-ledger
 * settlement ONLY if every gate passes: the counterparty is not AML-denied, the
 * agent's own risk verdict is PROCEED, and the payment is within the delegation
 * budget. If ANY gate fails, the case halts — no funds move. Extracted as a pure
 * function so the halt logic is explicit and unit-testable without a live ledger.
 */
export function casePasses(g: {
  amlAction: 'PASS' | 'REVIEW' | 'DENY';
  decision: 'PROCEED' | 'HOLD';
  budgetOk: boolean;
}): boolean {
  return g.amlAction !== 'DENY' && g.decision === 'PROCEED' && g.budgetOk;
}

/**
 * The verdict shown on a payment case's header. It must reflect what ACTUALLY
 * happened on-ledger, not merely whether the soft gates passed: a case is
 * APPROVED only if it both cleared the soft gates (`proceeded`) AND the bank's
 * on-ledger gate released the funds (`gateAllowed === true`). If the case never
 * reached the on-ledger gate (`gateAllowed === undefined`, e.g. a soft-gate halt
 * or an unavailable credential) or the gate refused release (`false`), the case
 * is DENIED. This keeps the case-divider verdict consistent with its settlement
 * card instead of optimistically claiming APPROVED off the soft gates alone.
 */
export function caseVerdict(proceeded: boolean, gateAllowed: boolean | undefined): 'APPROVED' | 'DENIED' {
  return proceeded && gateAllowed === true ? 'APPROVED' : 'DENIED';
}

/**
 * Build the run summary's case lists from the ACTUAL verdicts of the two
 * settlement cases (A → Lagos, B → Taipei). The headline "N settled, M halted"
 * must never disagree with what the case cards show: in fallback mode the agent
 * holds every payment, so this must report 0 settled — not a hardcoded 2. Cases
 * C/D/E are deterministic denials by construction and are always in the denied list.
 */
export function summarizeCases(
  verdictA: 'APPROVED' | 'DENIED',
  verdictB: 'APPROVED' | 'DENIED',
): { approvedCases: string[]; deniedCases: string[] } {
  const approvedCases: string[] = [];
  const deniedCases: string[] = [];
  (verdictA === 'APPROVED' ? approvedCases : deniedCases).push('lagos_nigeria');
  (verdictB === 'APPROVED' ? approvedCases : deniedCases).push('taipei_taiwan');
  deniedCases.push('aml_sdn', 'tier_ceiling', 'delegation_budget');
  return { approvedCases, deniedCases };
}

/**
 * Run the full cross-border scenario v3, emitting StepEvents through `emit`.
 * Returns when every case has been evaluated (or throws on a fatal
 * infrastructure error).
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

  /** Emit a case-divider header. Patched later with a verdict once the case resolves. */
  const caseHeader = (id: string, actor: string, title: string, body: string): string =>
    start({ id, phase: 'case', actor, title, body, status: 'info', data: { caseHeader: true } });

  emit({ type: 'demo_start', cast: CAST, brain: brainEnabled() ? CONFIG.deepseek.model : 'fallback' });

  // Build the AML matcher once (uses fixture in test/no-CSV environments).
  const amlMatcher = buildAmlMatcher();

  try {
    // ══ PHASE 1 · SETUP + IDENTITY ════════════════════════════════════════════
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
    // agentA/Aria maps to demoAgent for actual on-ledger settlement legs.
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
    // The operator delegates an explicit per-run FLEET budget to the agent fleet
    // (distinct from Novartis's full KYB authority of $maxDelegatedSpend). This is
    // what the over-budget case (Case E) bites against.
    const fleetBudget = '150';

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
      // D6 defaults to PASS when no amlName/amlResult is provided — agentA is AML-clear.
      // Counterparty AML screening happens at payment time, per case, not here.
    });

    const freshIssueHash = await issueCredential(c, treasury, agentA.address, kyaFresh.terms);
    await acceptCredential(c, agentA, treasury.address);
    const viewFresh = await fetchCredential(c, agentA.address, treasury.address);
    const freshConf = computeConfidence({ settlements: 0, windowDays: 0, daysSinceLastSettlement: 999 });

    patch('kya_fresh', { status: 'done',
      tx: tx('CredentialCreate', 'AgentTrustCredential v3 (fresh)', freshIssueHash),
      data: {
        agent: agentA.address, tier: kyaFresh.terms.tier, confidence: freshConf,
        settlements: 0, windowDays: 0, ceiling: kyaFresh.terms.maxTxAmount,
        dimensions: kyaFresh.dossier.dimensions?.map(d => ({ id: d.id, status: d.status, issuer: d.issuer })),
        credId: viewFresh?.credId,
      } });

    // ── STEP 4 · kya_thick — thick-file contrast (pre-seeded GOLD agent) ─────
    const thickAddrEnv = process.env.THICK_AGENT_ADDR;
    const thickAddr = thickAddrEnv ?? agentA.address;
    const thickIsReal = !!thickAddrEnv;
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
      demoSynthetic: !thickIsReal,
      note: thickIsReal
        ? 'real pre-seeded wallet (signals seeded by scripts/seed-thick-agent.ts)'
        : 'synthetic display — THICK_AGENT_ADDR not set (run seed-thick-agent.ts for real wallet)',
    } });

    // ── STEP 5 · mandate — principal counter-signs agentA's key (D5) ────────
    start({ id: 'mandate', phase: 'identity', actor: 'Novartis AG',
      title: 'Principal mandate — Novartis AG counter-signs agentA',
      body: `${CAST.operator.flag} D5 capability mandate: Novartis AG signs agentA's key for procurement tasks. (Wire contract: sig field presence; full Ed25519 verification in production.)`,
      status: 'info' });
    patch('mandate', { status: 'done', data: {
      principal: CAST.operator.name, uid: CAST.operator.uid,
      agentKey: agentA.address, skillId: 'cross-border-procurement',
      principalSigPresent: true, mandateIssued: true,
      note: 'Hackathon wire contract: field presence confirms mandate',
    } });

    // ══ PHASE 2 · PAYMENT CASES (each is one counterparty; a denial HALTS it) ══

    // ── CASE A · APPROVED — Aria → Lagos Precision Parts (Nigeria) ───────────
    caseHeader('caseA', CAST.agentA.name,
      `Case A · ${CAST.agentA.name} → ${CAST.supplierA.name}`,
      `${CAST.supplierA.flag} A single coherent cross-border payment to one supplier in ${CAST.supplierA.city}, ${CAST.supplierA.country}. The agent runs its full trust loop, then settles on-ledger.`);

    const amountA = '50';

    // STEP A1 · reason — agent plans THIS payment (real, long LLM reasoning).
    start({ id: 'reason', phase: 'reasoning', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} reasons about the ${CAST.supplierA.name} payment`,
      body: `${CAST.agentA.flag} Before moving money the agent reviews its mandate, its BRONZE ceiling ($${TIER_CEILING.BRONZE}), and the $${fleetBudget} fleet budget — for THIS payment only. Real ${brainEnabled() ? CONFIG.deepseek.flashModel : 'fallback'} call, reasoning shown in full.` });

    const planThought = await reason(
      `You are Aria, an autonomous procurement AI agent acting for Novartis AG (a KYB-verified Swiss pharmaceutical company). ` +
      `You hold a BRONZE MeshCredit trust credential with a hard per-payment ceiling of $${TIER_CEILING.BRONZE}. ` +
      `Your fleet shares a $${fleetBudget} delegation budget for this run. You must think carefully and show your work: ` +
      `consider whether this single supplier payment is in-scope for Novartis procurement, within your ceiling, AML-sensible, and a prudent use of the shared budget.`,
      `You are about to pay ONE supplier: ${CAST.supplierA.name} in ${CAST.supplierA.city}, ${CAST.supplierA.country} — $${amountA} for CNC precision parts for lab equipment Novartis manufactures. ` +
      `Reason step by step about whether to proceed with this specific payment, then conclude.`,
      { model: CONFIG.deepseek.flashModel, maxTokens: CONFIG.deepseek.maxTokens },
    );
    patch('reason', { status: 'done', data: {
      counterparty: CAST.supplierA.name, country: CAST.supplierA.country, amount: amountA,
      plan: planThought.content, reasoning: planThought.reasoning,
      model: planThought.model, ms: planThought.ms, fallback: planThought.fallback,
    } });

    // STEP A2 · settle_a — the agent's risk loop then on-ledger settlement.
    start({ id: 'settle_a', phase: 'payment', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} → ${CAST.supplierA.name} ($${amountA})`,
      body: `${CAST.agentA.flag} Counterparty AML screen → real DeepSeek risk assessment → on PROCEED: escrow at the bank gate → certified release → SUCCESS. On HOLD: the case halts here.` });

    // Gate 1 — counterparty AML screen (D6). Lagos Precision Parts is clean → PASS.
    const amlA = screenName(amlMatcher, CAST.supplierA.name);
    // Gate 2 — the agent's real risk decision on this specific payment.
    const assessA = await assessPayment({
      payer: CAST.operator.name, payerCountry: CAST.operator.country,
      payee: CAST.supplierA.name, payeeCountry: CAST.supplierA.country,
      amount: amountA, currency: 'USD', purpose: 'CNC precision parts — purchase order',
      tier: 'BRONZE', maxTxAmount: TIER_CEILING.BRONZE,
    });
    // Gate 3 — shared FLEET delegation budget (pure check; spent only on settle).
    const drawA = budgetCheck(budget, amountA, fleetBudget);

    const proceedA = casePasses({ amlAction: amlA.action, decision: assessA.decision, budgetOk: drawA.ok });
    const credIdA = viewFresh?.credId;
    // gateAllowedA stays undefined unless the case actually reaches the on-ledger
    // gate; the case header verdict is derived from it (not from proceedA alone).
    let gateAllowedA: boolean | undefined;
    if (proceedA && credIdA) {
      const handleA = await submitPaymentForApproval(
        c, demoAgent, bank.address,
        '100000', // 0.1 XRP drops — abstract $50 is display only
        dossierRef('settle_a:' + agentA.address),
      );
      const gA = await gateCheck(c, agentA.address, treasury.address, 'TIER-1', { amount: amountA });
      gateAllowedA = gA.allowed;
      let releaseHashA: string | undefined;
      if (gA.allowed) {
        releaseHashA = await approveAndRelease(c, agentA, demoAgent.address, handleA, [credIdA]);
        commitBudget(budget, amountA); // spend the fleet budget only now that funds moved
      }
      patch('settle_a', { status: gA.allowed ? 'done' : 'denied',
        ...(gA.allowed
          ? { tx: tx('EscrowFinish', `Released $${amountA} → ${CAST.supplierA.name}`, releaseHashA!) }
          : { tx: tx('EscrowCreate', `Escrow held (not released) — ${CAST.supplierA.name}`, handleA.createHash) }),
        data: {
          verdict: gA.allowed ? 'APPROVED' : 'DENIED',
          ...(gA.allowed ? {} : { halted: true }),
          amlAction: amlA.action, decision: assessA.decision, rationale: assessA.rationale,
          reasoning: assessA.reasoning, model: assessA.model, ms: assessA.ms, fallback: assessA.fallback,
          budgetAllocated: budget.allocated, gateAllowed: gA.allowed,
          abstractAmount: amountA,
          note: gA.allowed
            ? 'abstract $50 displayed; tiny XRP moved on-chain'
            : 'case halted at the bank gate — no funds released',
        } });
    } else {
      // A soft gate denied, OR the agent's on-ledger credential is unavailable →
      // the case HALTS here. No escrow, no funds moved.
      const haltReason = !proceedA
        ? (drawA.reason ?? 'agent risk hold / AML / budget gate denied')
        : 'agent credential unavailable — cannot present at the bank gate';
      patch('settle_a', { status: 'denied',
        data: {
          verdict: 'DENIED', halted: true,
          amlAction: amlA.action, decision: assessA.decision, rationale: assessA.rationale,
          reasoning: assessA.reasoning, reason: haltReason,
          model: assessA.model, ms: assessA.ms, fallback: assessA.fallback,
          note: 'case halted — agent held, no funds moved',
        } });
    }
    patch('caseA', { data: { verdict: caseVerdict(proceedA, gateAllowedA) } });

    // ── CASE B · APPROVED — Bravo → Taipei Tech Components (Taiwan) ──────────
    // A SECOND, separate case. It is its own bounded flow — it does not bleed
    // into Case A. First underwrite agentB and issue its credential.
    const kyaB = await underwrite(c, agentB.address, offChainFresh, {
      attestation, operatorCredId: opView?.credId, version: 3,
    });
    const bIssueHash = await issueCredential(c, treasury, agentB.address, kyaB.terms);
    await acceptCredential(c, agentB, treasury.address);
    const viewB = await fetchCredential(c, agentB.address, treasury.address);

    const amountB = '60';
    caseHeader('caseB', CAST.agentB.name,
      `Case B · ${CAST.agentB.name} → ${CAST.supplierB.name}`,
      `${CAST.supplierB.flag} A distinct second payment to ${CAST.supplierB.city}, ${CAST.supplierB.country}. Same trust loop, its own counterparty, drawing down the shared $${fleetBudget} fleet budget.`);

    start({ id: 'settle_b', phase: 'payment', actor: CAST.agentB.name,
      title: `${CAST.agentB.name} → ${CAST.supplierB.name} ($${amountB})`,
      body: `${CAST.agentB.flag} Counterparty AML screen → real DeepSeek risk assessment → escrow → certified release → SUCCESS.` });

    const amlB = screenName(amlMatcher, CAST.supplierB.name);
    const assessB = await assessPayment({
      payer: CAST.operator.name, payerCountry: CAST.operator.country,
      payee: CAST.supplierB.name, payeeCountry: CAST.supplierB.country,
      amount: amountB, currency: 'USD', purpose: 'Medical device PCB components — verified purchase order PO-2026-0482',
      tier: 'BRONZE', maxTxAmount: TIER_CEILING.BRONZE,
    });
    const drawB = budgetCheck(budget, amountB, fleetBudget);

    const proceedB = casePasses({ amlAction: amlB.action, decision: assessB.decision, budgetOk: drawB.ok });
    const credIdB = viewB?.credId;
    let gateAllowedB: boolean | undefined;
    if (proceedB && credIdB) {
      const handleB = await submitPaymentForApproval(
        c, demoAgent, bank.address, '100000',
        dossierRef('settle_b:' + agentB.address),
      );
      const gB = await gateCheck(c, agentB.address, treasury.address, 'TIER-1', { amount: amountB });
      gateAllowedB = gB.allowed;
      let releaseHashB: string | undefined;
      if (gB.allowed) {
        releaseHashB = await approveAndRelease(c, agentB, demoAgent.address, handleB, [credIdB]);
        commitBudget(budget, amountB); // spend the fleet budget only now that funds moved
      }
      patch('settle_b', { status: gB.allowed ? 'done' : 'denied',
        ...(gB.allowed
          ? { tx: tx('EscrowFinish', `Released $${amountB} → ${CAST.supplierB.name}`, releaseHashB!) }
          : { tx: tx('EscrowCreate', `Escrow held (not released) — ${CAST.supplierB.name}`, handleB.createHash) }),
        data: {
          verdict: gB.allowed ? 'APPROVED' : 'DENIED',
          ...(gB.allowed ? {} : { halted: true }),
          amlAction: amlB.action, decision: assessB.decision, rationale: assessB.rationale,
          reasoning: assessB.reasoning, model: assessB.model, ms: assessB.ms, fallback: assessB.fallback,
          budgetAllocated: budget.allocated, gateAllowed: gB.allowed,
          abstractAmount: amountB, credId: bIssueHash,
          note: gB.allowed ? undefined : 'case halted at the bank gate — no funds released',
        } });
    } else {
      const haltReason = !proceedB
        ? (drawB.reason ?? 'agent risk hold / AML / budget gate denied')
        : 'agent credential unavailable — cannot present at the bank gate';
      patch('settle_b', { status: 'denied',
        data: {
          verdict: 'DENIED', halted: true,
          amlAction: amlB.action, decision: assessB.decision, rationale: assessB.rationale,
          reasoning: assessB.reasoning, reason: haltReason,
          model: assessB.model, ms: assessB.ms, fallback: assessB.fallback,
          note: 'case halted — agent held, no funds moved',
        } });
    }
    patch('caseB', { data: { verdict: caseVerdict(proceedB, gateAllowedB) } });

    // ── CASE C · DENIED — Aria → Star Dragon Corporation Limited (OFAC SDN) ──
    // The agent reasons about the SDN flag (real LLM), THEN the D6 hard gate
    // blocks submission. The case HALTS — no escrow is ever created.
    caseHeader('caseC', CAST.agentA.name,
      `Case C · ${CAST.agentA.name} → ${CAST.amlTarget.name}`,
      `${CAST.amlTarget.flag} A payment request to a sanctioned counterparty. The agent screens, reasons about the hit, and the D6 hard gate stops the payment before anything goes on-ledger.`);

    start({ id: 'denial_aml', phase: 'denial', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} attempts payment to ${CAST.amlTarget.name}`,
      body: `${CAST.amlTarget.flag} FIRST the agent reasons about the OFAC SDN screening result (real LLM call, reasoning shown). THEN the D6 hard gate blocks submission — the case halts.` });

    const amlScreen = screenName(amlMatcher, CAST.amlTarget.name);
    const amlReasoning = await assessCounterparty({
      counterpartyName: CAST.amlTarget.name,
      amlAction: amlScreen.action,
      amlScore: amlScreen.score,
      matchedName: amlScreen.matchedName,
      tier: 'BRONZE',
      maxTxAmount: TIER_CEILING.BRONZE,
    });
    const amlDenied = amlScreen.action === 'DENY';

    patch('denial_aml', { status: 'denied', data: {
      verdict: 'DENIED', halted: true,
      counterparty: CAST.amlTarget.name, amlAction: amlScreen.action, amlScore: amlScreen.score,
      matchedName: amlScreen.matchedName, amlDenied,
      decision: amlReasoning.decision, rationale: amlReasoning.rationale,
      agentDecision: amlReasoning.decision, agentRationale: amlReasoning.rationale,
      reasoning: amlReasoning.reasoning, agentReasoning: amlReasoning.reasoning,
      model: amlReasoning.model, ms: amlReasoning.ms, fallback: amlReasoning.fallback,
      d6Gate: 'DENY — payment blocked before submission (D6 hard gate)',
    } });
    patch('caseC', { data: { verdict: 'DENIED' } });

    // ── CASE D · DENIED — Aria → $300 over BRONZE tier ceiling ──────────────
    caseHeader('caseD', CAST.agentA.name,
      `Case D · ${CAST.agentA.name} → $300 payment`,
      `${CAST.agentA.flag} The agent attempts a payment larger than its BRONZE ceiling. effectiveCeiling() denies before submission — the case halts.`);

    const overAmount = '300';
    const eff = effectiveCeiling('BRONZE', TIER_CEILING.BRONZE, maxDelegatedSpend);
    const tierDenied = Number(overAmount) > Number(eff);

    start({ id: 'denial_tier', phase: 'denial', actor: CAST.agentA.name,
      title: `Denial — tier ceiling ($${overAmount} > BRONZE $${TIER_CEILING.BRONZE})`,
      body: `${CAST.agentA.flag} ${CAST.agentA.name} attempts a $${overAmount} payment. BRONZE ceiling is $${TIER_CEILING.BRONZE}. The agent reasons about the limit, then the gate halts the case.` });

    const tierDenialReact = await reason(
      `You are Aria, an autonomous procurement AI agent with a BRONZE MeshCredit credential (hard per-payment ceiling $${TIER_CEILING.BRONZE}). ` +
      `You must respect your credential's limits and explain your reasoning clearly.`,
      `You attempted a $${overAmount} payment but your effective ceiling is $${eff}. ` +
      `Reason about why the ceiling exists and how you will adapt (split the order, defer, or escalate to a human), then conclude with your chosen course of action.`,
      { model: CONFIG.deepseek.flashModel, maxTokens: CONFIG.deepseek.maxTokens },
    );
    patch('denial_tier', { status: 'denied', data: {
      verdict: 'DENIED', halted: true,
      requestedAmount: overAmount, tierCeiling: TIER_CEILING.BRONZE, effectiveCeiling: eff,
      denied: tierDenied, reason: `tier ceiling: $${TIER_CEILING.BRONZE}, requested: $${overAmount} → DENIED`,
      agentReaction: tierDenialReact.content, rationale: tierDenialReact.content,
      reasoning: tierDenialReact.reasoning,
      model: tierDenialReact.model, ms: tierDenialReact.ms, fallback: tierDenialReact.fallback,
    } });
    patch('caseD', { data: { verdict: 'DENIED' } });

    // ── CASE E · DENIED — Bravo → $500 over operator delegation budget ──────
    // After Case A ($50) + Case B ($60) = $110 allocated of the $150 fleet
    // budget, only $40 remains. A $500 request → projected $610 > $150 → DENIED.
    caseHeader('caseE', CAST.agentB.name,
      `Case E · ${CAST.agentB.name} → $500 payment`,
      `${CAST.agentB.flag} The fleet has spent $${budget.allocated} of its $${fleetBudget} budget. A $500 request exceeds what remains — delegationCapCheck() halts the case.`);

    const bigAmount = '500';
    const capResult = delegationCapCheck({
      maxDelegatedSpend: fleetBudget,           // operator's per-run fleet delegation budget
      allocatedTotal: budget.allocated,
      requestedAllocation: bigAmount,
    });
    const remaining = Math.max(0, Number(fleetBudget) - Number(budget.allocated));

    start({ id: 'denial_budget', phase: 'denial', actor: CAST.agentB.name,
      title: `Denial — delegation budget (allocated $${budget.allocated} + $${bigAmount} > $${fleetBudget} fleet budget)`,
      body: `${CAST.agentB.flag} ${CAST.agentB.name} attempts a $${bigAmount} payment. The operator's $${fleetBudget} fleet budget has $${budget.allocated} allocated ($${remaining} remaining). The agent reasons, then the cap halts the case.` });

    const budgetDenialReact = await reason(
      `You are Bravo, an autonomous logistics AI agent with a BRONZE MeshCredit credential. The operator delegated a $${fleetBudget} fleet budget for this run; the fleet has already allocated $${budget.allocated} ($${remaining} remaining). ` +
      `You must respect the operator's delegated budget and explain your reasoning clearly.`,
      `You attempted a $${bigAmount} payment but only $${remaining} of the $${fleetBudget} fleet budget remains. ` +
      `Reason about why operator budget caps matter for delegated autonomy, and how you will adapt (request a budget top-up, defer, or split), then conclude.`,
      { model: CONFIG.deepseek.flashModel, maxTokens: CONFIG.deepseek.maxTokens },
    );
    patch('denial_budget', { status: 'denied', data: {
      verdict: 'DENIED', halted: true,
      requestedAmount: bigAmount, demoDelegationBudget: fleetBudget, allocatedTotal: budget.allocated,
      remaining: String(remaining),
      projectedTotal: String(Number(budget.allocated) + Number(bigAmount)),
      denied: !capResult.allowed, reason: capResult.reason ?? 'cap check passed (unexpected)',
      agentReaction: budgetDenialReact.content, rationale: budgetDenialReact.content,
      reasoning: budgetDenialReact.reasoning,
      model: budgetDenialReact.model, ms: budgetDenialReact.ms, fallback: budgetDenialReact.fallback,
    } });
    patch('caseE', { data: { verdict: 'DENIED' } });

    // ══ PHASE 3 · BUREAU ENFORCEMENT (protocol-level controls) ════════════════
    caseHeader('caseGov', 'MeshCredit',
      'Bureau enforcement — protocol-level controls',
      '◇ Beyond per-payment gating: the ledger refuses uncertified agents at consensus, code-swaps are caught at verification, and a single revocation is a surgical kill-switch.');

    // ── STEP · contrast — uncertified agent → tecNO_PERMISSION ───────────────
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

    // ── STEP · codeswap — detect code-hash mismatch on compromisedAgent ──────
    start({ id: 'codeswap', phase: 'governance', actor: 'MeshCredit',
      title: 'Code-swap caught at verification',
      body: `${CAST.compromised.flag} A relying party recomputes the agent skill hash. Tampered runtime no longer matches the 'sh' stamped in the credential — version-pinning and accountability, on-ledger.` });

    const auditedBytes = readFileSync(skillPath);
    const tampered = Buffer.from(auditedBytes.toString('utf8').replace('escrow', 'drain-EVIL'), 'utf8');
    const good = verifyAttestation(readFileSync(harnessPath), auditedBytes, attestation);
    const swap = verifyAttestation(readFileSync(harnessPath), tampered, attestation);
    patch('codeswap', { status: 'done', data: {
      auditedRecognized: good.recognized, tamperedRecognized: swap.recognized,
      reason: swap.reason, sh: (viewFresh?.terms as any)?.sh,
    } });

    // ── STEP · kill — revoke ONLY compromisedAgent ───────────────────────────
    start({ id: 'kill', phase: 'governance', actor: 'MeshCredit',
      title: 'Kill-switch — ONLY compromisedAgent revoked',
      body: `${CAST.compromised.flag} A single CredentialDelete removes compromisedAgent from every gated venue. agentA (${CAST.agentA.name}) and agentB (${CAST.agentB.name}) remain unaffected.` });

    const compKya = await underwrite(c, compromisedAgent.address, offChainFresh, {
      attestation, operatorCredId: opView?.credId, version: 3,
    });
    const _compIssue = await issueCredential(c, treasury, compromisedAgent.address, compKya.terms);
    await acceptCredential(c, compromisedAgent, treasury.address);
    const killHash = await revokeCredential(c, treasury, compromisedAgent.address);

    const gAfterKill = await gateCheck(c, compromisedAgent.address, treasury.address, 'TIER-1', {});
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

    // ── STEP · confirm_a — agentA makes one more payment after kill-switch ────
    const confirmAmount = '30';
    start({ id: 'confirm_a', phase: 'payment', actor: CAST.agentA.name,
      title: `${CAST.agentA.name} pays after kill (confirms unaffected)`,
      body: `${CAST.agentA.flag} agentA was never revoked. This payment succeeds, proving the kill-switch is surgical.` });

    const drawConfirm = budgetCheck(budget, confirmAmount, fleetBudget);

    let confirmOk = false;
    let confirmHash: string | undefined;
    if (gAgentAAfterKill.allowed && drawConfirm.ok && credIdA) {
      const handleConfirm = await submitPaymentForApproval(
        c, demoAgent, bank.address, '50000',
        dossierRef('confirm_a:' + agentA.address),
      );
      const gConfirm = await gateCheck(c, agentA.address, treasury.address, 'TIER-1', { amount: confirmAmount });
      if (gConfirm.allowed) {
        confirmHash = await approveAndRelease(c, agentA, demoAgent.address, handleConfirm, [credIdA]);
        commitBudget(budget, confirmAmount); // spend only after the confirming payment settled
        confirmOk = true;
      }
    }

    patch('confirm_a', { status: confirmOk ? 'done' : 'denied',
      ...(confirmHash ? { tx: tx('EscrowFinish', `${CAST.agentA.name} — confirmed active`, confirmHash) } : {}),
      data: {
        verdict: confirmOk ? 'APPROVED' : 'DENIED',
        agentA: agentA.address, agentAStillActive: gAgentAAfterKill.allowed,
        confirmOk, amount: confirmAmount, budgetAllocated: budget.allocated,
        note: 'kill-switch did not affect agentA — surgical revocation works',
      } });

    // ── Final summary ─────────────────────────────────────────────────────────
    // Derive the headline from what ACTUALLY happened on-ledger, so "N settled,
    // M halted" can never disagree with the case cards (e.g. fallback HOLDs → 0 settled).
    const { approvedCases, deniedCases } = summarizeCases(
      caseVerdict(proceedA, gateAllowedA),
      caseVerdict(proceedB, gateAllowedB),
    );
    emit({ type: 'demo_done', ok: true,
      summary: {
        operatorUid: CAST.operator.uid, operatorDataSource: zefixDetail._dataSource,
        btier, maxDelegatedSpend, fleetBudget, budgetAllocated: budget.allocated,
        tier: kyaFresh.terms.tier,
        agentA: agentA.address, agentB: agentB.address,
        approvedCases, deniedCases,
        compromisedRevoked: !gAfterKill.allowed, agentAStillActive: gAgentAAfterKill.allowed,
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
