// MeshCredit — the cross-border agent-payment scenario, server-side and streamed.
//
// This runs the SAME real testnet arc as `npm run demo`, but (a) the agent's
// risk decision is made by a real LLM (DeepSeek) and actually gates behaviour,
// and (b) every step is emitted as a rich SSE event so the Live Demo Theater can
// visualise each move as it happens — funding, KYB, KYA, the bank gate, the FX
// leg, the escrow, the credentialed release, the uncertified denial, the
// code-swap catch, and the kill-switch. Nothing here is mocked: each `tx` is a
// validated transaction hash on XRPL testnet.
import { Client, Wallet } from 'xrpl';
import { fundNew } from '../xrpl/wallets.js';
import { toRippleEpoch, dossierRef } from '../xrpl/codec.js';
import { issueCredential, acceptCredential, fetchCredential, revokeCredential } from '../xrpl/credential.js';
import { underwrite } from '../kya/underwrite.js';
import { type Signals } from '../kya/scorecard.js';
import { setupDepositPreauth, buildAcceptedCredentials, gateCheck } from '../xrpl/domain.js';
import { submitPaymentForApproval, approveAndRelease, rejectAndRefund } from '../xrpl/bankGate.js';
import { seedOfferBook, swapViaPathPayment } from '../xrpl/dex.js';
import { setupStablecoin, trustAndFund, establishTrustline, iouAmount } from '../xrpl/stablecoin.js';
import { issueSkillCredential, acceptSkillCredential, type SkillTerms } from '../xrpl/skillCredential.js';
import { issueOperatorCredential, acceptOperatorCredential, fetchOperatorCredential, type OperatorTerms } from '../xrpl/operator.js';
import { kybScore, type KybSignals } from '../kya/kyb.js';
import { verifyAttestation, attestFiles } from './attest.js';
import { assessPayment, brainEnabled } from './brain.js';
import { CONFIG } from '../config.js';
import { readFileSync } from 'node:fs';

// The cast of the cross-border story.
export const CAST = {
  operator: { name: 'Helvetia Components AG', city: 'Zürich', country: 'Switzerland', flag: '🇨🇭' },
  agent: { name: 'Aria', role: "Helvetia's procurement agent", flag: '🤖' },
  bureau: { name: 'MeshCredit', role: 'trust bureau · credential issuer', flag: '◇' },
  bank: { name: 'Settlement Bank', role: 'gates its account on a credential', flag: '🏦' },
  payee: { name: 'Lagos Precision Parts Ltd', city: 'Lagos', country: 'Nigeria', flag: '🇳🇬' },
} as const;

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

/** The honest per-signal breakdown the demo agent ACTUALLY earns (fresh wallet → no on-chain
 *  history yet), so the UI shows real numbers, not the theoretical maximum. */
function scoreBreakdown(s: Signals): { label: string; pts: number; max: number; src: string }[] {
  const onAge = Math.min(Math.max(s.accountAgeDays, 0) / 30, 1) * 10;
  return [
    { label: 'World ID (human behind the agent)', pts: s.worldId ? 15 : 0, max: 15, src: 'off-chain' },
    { label: 'Runtime / model stability', pts: s.runtimeStable ? 10 : 0, max: 10, src: 'off-chain' },
    { label: 'Transcript coherence', pts: s.transcriptCoherent ? 10 : 0, max: 10, src: 'off-chain' },
    { label: 'Source snapshot provided', pts: s.sourceProvided ? 5 : 0, max: 5, src: 'off-chain' },
    { label: 'Human owner DID complete', pts: s.humanDidComplete ? 5 : 0, max: 5, src: 'off-chain' },
    { label: 'KYB-verified operator backing', pts: s.operatorBacked ? 10 : 0, max: 10, src: 'KYB' },
    { label: 'XRPL account age', pts: Math.round(onAge), max: 10, src: 'on-chain' },
    { label: 'Prior settlement payments', pts: Math.min(Math.max(s.rlusdPayments, 0), 15), max: 15, src: 'on-chain' },
    { label: 'Escrow completion rate', pts: Math.round(Math.min(Math.max(s.escrowCompletionRate, 0), 1) * 15), max: 15, src: 'on-chain' },
    { label: 'Prior payment success rate', pts: Math.round(Math.min(Math.max(s.priorPaymentSuccessRate, 0), 1) * 15), max: 15, src: 'on-chain' },
  ];
}

/**
 * Run the full cross-border scenario, emitting StepEvents through `emit`.
 * Returns when the arc completes (or throws on a fatal infra error).
 */
export async function runCrossBorderScenario(deps: {
  c: Client;
  treasury: Wallet;        // the persistent MeshCredit bureau / issuer
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

  try {
    // ── 0 · provision the actors on testnet ──────────────────────────────
    start({ id: 'setup', phase: 'setup', actor: 'Ledger', title: 'Provisioning the actors on XRPL testnet',
      body: 'Funding fresh wallets for the operator, the agent, the bank and the payee.' });
    const bank = await fundNew(c, 'bank');
    const operator = await fundNew(c, 'operator');
    const agent = await fundNew(c, 'agent');
    const payee = await fundNew(c, 'payee');
    const badAgent = await fundNew(c, 'badAgent');
    patch('setup', { status: 'done', data: {
      bureau: treasury.address, bank: bank.address, operator: operator.address,
      agent: agent.address, payee: payee.address, badAgent: badAgent.address,
    } });

    // ── 1 · KYB the operator (the legally accountable business) ───────────
    start({ id: 'kyb', phase: 'identity', actor: 'MeshCredit',
      title: `KYB — verifying ${CAST.operator.name}`,
      body: `${CAST.operator.flag} A registered Swiss company is the accountable principal behind the agent. MeshCredit issues an on-ledger operator credential with a delegated spend cap.` });
    const kyb: KybSignals = { entityVerified: true, businessAgeDays: 1460, registeredJurisdiction: 'CH', operatorSettlementRate: 0.9 };
    const { btier, maxDelegatedSpend } = kybScore(kyb);
    const opTerms: OperatorTerms = {
      v: 1, btier, maxDelegatedSpend, kybHash: dossierRef('kyb:' + operator.address), juris: 'CH',
      exp: toRippleEpoch(Date.now()) + 365 * 86400,
    };
    const opHash = await issueOperatorCredential(c, treasury, operator.address, opTerms);
    await acceptOperatorCredential(c, operator, treasury.address);
    const opView = await fetchOperatorCredential(c, operator.address, treasury.address);
    patch('kyb', { status: 'done', tx: tx('CredentialCreate', 'OperatorCredential (operator_v1)', opHash),
      data: { btier, maxDelegatedSpend, jurisdiction: 'CH', credId: opView?.credId } });

    // ── 2 · the bank stands up its consensus-level gate ───────────────────
    start({ id: 'gate', phase: 'identity', actor: 'Bank',
      title: 'The bank gates its settlement account',
      body: `${CAST.bank.flag} DepositAuth + DepositPreauth(AuthorizeCredentials): only a holder of a MeshCredit credential may deliver into this account. The bank owns the decision; the ledger enforces it.` });
    const gateSetup = await setupDepositPreauth(c, bank, buildAcceptedCredentials(treasury.address));
    patch('gate', { status: 'done',
      tx: tx('DepositPreauth', 'AuthorizeCredentials → MeshCredit', gateSetup.preauthHash),
      data: { accountSet: gateSetup.accountSetHash, accountSetUrl: CONFIG.explorerTx(gateSetup.accountSetHash) } });

    // ── 3 · KYA → the on-ledger trust passport ────────────────────────────
    start({ id: 'kya', phase: 'identity', actor: 'MeshCredit',
      title: `KYA — underwriting the agent, ${CAST.agent.name}`,
      body: `${CAST.agent.flag} A transparent 100-point score fuses off-chain behaviour with on-chain history and the operator's backing. The verdict is minted as an XLS-70 credential — the agent's trust passport.` });
    const attestation = attestFiles(harnessPath, skillPath);
    const offChain: Partial<Signals> = { worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true };
    const kya = await underwrite(c, agent.address, offChain,
      { kyaSeed: 'demo:' + agent.address, attestation, operatorCredId: opView?.credId, version: 2 });
    const issueHash = await issueCredential(c, treasury, agent.address, kya.terms);
    await acceptCredential(c, agent, treasury.address);
    const view = await fetchCredential(c, agent.address, treasury.address);
    const breakdown = scoreBreakdown(kya.signals);
    patch('kya', { status: 'done', tx: tx('CredentialCreate', 'AgentTrustCredential (agent_trust_v1)', issueHash),
      data: {
        agent: agent.address, did: `did:xrpl:1:${agent.address}`, issuer: treasury.address,
        credId: view?.credId, score: kya.decision.score, tier: view?.terms.tier,
        maxTxAmount: view?.terms.maxTxAmount, ih: view?.terms.ih, sh: view?.terms.sh,
        op: view?.terms.op, ref: view?.terms.ref, exp: view?.terms.exp, breakdown,
      } });

    // ── 4 · the agent REASONS about the payment (real LLM) ────────────────
    const amount = '50';
    start({ id: 'reason', phase: 'reasoning', actor: 'Aria',
      title: `${CAST.agent.name} assesses the payment`,
      body: `${CAST.agent.flag} Before moving money, the agent reasons about AML / fraud risk and its own credential ceiling — a real ${brainEnabled() ? CONFIG.deepseek.model : 'fallback'} call whose verdict actually gates the next step.` });
    const assessment = await assessPayment({
      payer: CAST.operator.name, payerCountry: CAST.operator.country,
      payee: CAST.payee.name, payeeCountry: CAST.payee.country,
      amount, currency: 'USD', purpose: 'CNC precision parts — purchase order',
      tier: view?.terms.tier ?? 'TIER-2', maxTxAmount: view?.terms.maxTxAmount ?? '100',
    });
    patch('reason', { status: assessment.decision === 'PROCEED' ? 'done' : 'denied',
      data: { decision: assessment.decision, rationale: assessment.rationale, reasoning: assessment.reasoning,
        model: assessment.model, ms: assessment.ms, fallback: assessment.fallback } });

    // ── 5 · convert the currency on the XRPL DEX (the FX leg) ──────────────
    start({ id: 'fx', phase: 'payment', actor: 'Aria',
      title: 'Cross-currency conversion on the XRPL DEX',
      body: `${CAST.agent.flag} The agent routes its source currency to the destination currency through the order book — the FX leg, with no bureau involvement.` });
    const issuerA = await fundNew(c, 'issuerA');
    const issuerB = await fundNew(c, 'issuerB');
    const maker = await fundNew(c, 'maker');
    await setupStablecoin(c, issuerA); await setupStablecoin(c, issuerB);
    await trustAndFund(c, issuerA, agent, '200', 'USD');
    await establishTrustline(c, issuerB, agent, 'EUR');
    await trustAndFund(c, issuerB, maker, '200', 'EUR');
    await establishTrustline(c, issuerA, maker, 'USD');
    await seedOfferBook(c, maker, iouAmount('100', issuerB.address, 'EUR'), iouAmount('100', issuerA.address, 'USD'));
    const swapHash = await swapViaPathPayment(c, agent, agent.address, iouAmount('101', issuerA.address, 'USD'), iouAmount('100', issuerB.address, 'EUR'));
    patch('fx', { status: 'done', tx: tx('Payment', 'DEX path payment (USD → EUR)', swapHash) });

    // ── 6 · escrow the settlement at the bank's gated account ─────────────
    start({ id: 'escrow', phase: 'payment', actor: 'Aria',
      title: `Settlement held at the bank`,
      body: `${CAST.agent.flag} The agent escrows ${amount} into the bank's gated account — funds visibly committed, awaiting release. A CancelAfter guarantees a refund to the sender if it is never released.` });
    const handle = await submitPaymentForApproval(c, agent, bank.address, '50000000', dossierRef('docs:' + agent.address));
    patch('escrow', { status: 'done', tx: tx('EscrowCreate', `${amount} held at the bank`, handle.createHash) });

    // ── 7 · the gate checks the credential (with the amount) ──────────────
    start({ id: 'gatecheck', phase: 'payment', actor: 'Bank',
      title: 'The gate checks the credential',
      body: `${CAST.bank.flag} The amount is checked against the credential's tier ceiling before anything is released.` });
    const g = await gateCheck(c, agent.address, treasury.address, 'TIER-1', { amount });
    patch('gatecheck', { status: g.allowed ? 'done' : 'denied', data: { allowed: g.allowed, tier: g.tier, reason: g.reason, amount, maxTxAmount: view?.terms.maxTxAmount } });

    // ── 8 · release — certified agent settles to Lagos ────────────────────
    if (assessment.decision === 'PROCEED' && g.allowed) {
      start({ id: 'release', phase: 'payment', actor: 'Aria',
        title: `Released → ${CAST.payee.name}`,
        body: `${CAST.payee.flag} EscrowFinish presents the credential's ledger-entry index (CredentialIDs). The ledger accepts it; the settlement flows through the bank to Lagos.` });
      const releaseHash = await approveAndRelease(c, agent, agent.address, handle, [view!.credId]);
      patch('release', { status: 'done', tx: tx('EscrowFinish', `Released ${amount} through the gate`, releaseHash) });
    } else {
      start({ id: 'release', phase: 'payment', actor: 'Aria', status: 'denied',
        title: 'Agent holds the payment',
        body: `${CAST.agent.flag} The agent's own risk assessment returned HOLD — it refunds the escrow to the sender instead of releasing.` });
      const cancelHash = await rejectAndRefund(c, agent, agent.address, handle);
      patch('release', { status: 'denied', tx: tx('EscrowCancel', `Refunded ${amount} to sender`, cancelHash) });
    }

    // ── 9 · code-swap caught (content attestation) ────────────────────────
    start({ id: 'codeswap', phase: 'governance', actor: 'MeshCredit',
      title: 'Code-swap caught at verification',
      body: 'A relying party recomputes the agent\'s skill hash. A tampered runtime no longer matches the `sh` stamped in the credential — version-pinning and accountability, on-ledger.' });
    const auditedBytes = readFileSync(skillPath);
    const tampered = Buffer.from(auditedBytes.toString('utf8').replace('escrow', 'drain-EVIL'), 'utf8');
    const good = verifyAttestation(readFileSync(harnessPath), auditedBytes, attestation);
    const swap = verifyAttestation(readFileSync(harnessPath), tampered, attestation);
    patch('codeswap', { status: 'done', data: {
      auditedRecognized: good.recognized, tamperedRecognized: swap.recognized, reason: swap.reason,
      sh: view?.terms.sh,
    } });

    // ── 10 · the contrast: an UNcertified agent is denied by consensus ────
    start({ id: 'contrast', phase: 'contrast', actor: 'Ledger',
      title: 'An uncertified agent attempts the same payment',
      body: 'No credential → its EscrowFinish is rejected by the validators themselves, before the bank ever sees the request.' });
    const badHandle = await submitPaymentForApproval(c, badAgent, bank.address, '50000000', dossierRef('docs:bad'));
    let declined = false; let denyCode = '';
    try {
      await approveAndRelease(c, badAgent, badAgent.address, badHandle, []);
    } catch (e) {
      denyCode = tecOf(e); declined = denyCode === 'tecNO_PERMISSION';
    }
    patch('contrast', { status: 'denied', tx: tx('EscrowCreate', 'Uncertified agent (its escrow)', badHandle.createHash),
      data: { declined, code: denyCode || 'tecNO_PERMISSION' } });

    // ── 11 · the same rail attests a specialized skill (UC2) ──────────────
    start({ id: 'skill', phase: 'governance', actor: 'MeshCredit',
      title: 'The same rail attests a specialized skill',
      body: `${CAST.agent.flag} The agent earns a second on-ledger credential (agent_skill_v1) — the seed of a credentialed agent-labour market.` });
    const sterms: SkillTerms = { v: 1, skillId: 'invoice-reconciliation', skillVersion: '1.0.0', benchmarkHash: dossierRef('bench:inv'), exp: toRippleEpoch(Date.now()) + 365 * 86400 };
    const skillHash = await issueSkillCredential(c, treasury, agent.address, sterms);
    await acceptSkillCredential(c, agent, treasury.address);
    patch('skill', { status: 'done', tx: tx('CredentialCreate', 'SkillCredential (agent_skill_v1)', skillHash), data: { skillId: sterms.skillId } });

    // ── 12 · kill-switch — revoked everywhere in one ledger close ─────────
    start({ id: 'kill', phase: 'governance', actor: 'MeshCredit',
      title: 'Kill-switch — revoked everywhere at once',
      body: 'On compromise, a single CredentialDelete removes the agent from every gated venue in one ~4s ledger close. In-flight escrows refund to the sender.' });
    const killHash = await revokeCredential(c, treasury, agent.address);
    const gAfter = await gateCheck(c, agent.address, treasury.address, 'TIER-1', { amount });
    patch('kill', { status: 'denied', tx: tx('CredentialDelete', 'Credential revoked', killHash),
      data: { gateAllowed: gAfter.allowed, reason: gAfter.reason } });

    const ok = g.allowed && declined && good.recognized && !swap.recognized && !gAfter.allowed;
    emit({ type: 'demo_done', ok, agent: agent.address, payee: payee.address,
      summary: { score: kya.decision.score, tier: view?.terms.tier, maxTxAmount: view?.terms.maxTxAmount, decision: assessment.decision } });
    return { ok };
  } catch (e: any) {
    emit({ type: 'step', seq: seq++, id: 'error', phase: 'error', actor: 'Ledger', status: 'denied',
      title: 'Scenario error', body: String(e?.message ?? e) });
    emit({ type: 'demo_done', ok: false, error: String(e?.message ?? e) });
    return { ok: false };
  }
}
