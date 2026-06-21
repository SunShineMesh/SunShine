// MeshCredit treasury/API server — the product surface for the trust bureau and
// the bank-gate cross-border payment flow:
//   KYA → on-ledger AgentTrustCredential → escrow into the bank's gated account
//   → certified release (or ledger denial for the uncertified) → public bureau
//   lookup, KYB operator layer, skill credentials (UC2), and a live SSE feed.
//
//   npm run server
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { type Client, type Wallet, xrpToDrops } from 'xrpl';
import { getClient } from '../xrpl/client.js';
import { loadOrFund, fundNew } from '../xrpl/wallets.js';
import { underwrite } from '../kya/underwrite.js';
import { issueCredential, acceptCredential, fetchCredential, revokeCredential } from '../xrpl/credential.js';
import { toRippleEpoch, dossierRef } from '../xrpl/codec.js';
import { PaymentStore } from './paymentStore.js';
import { CONFIG, assetLabel } from '../config.js';
import type { Signals, Tier } from '../kya/scorecard.js';
import { kybScore } from '../kya/kyb.js';
import type { KybSignals } from '../kya/kyb.js';
import {
  issueOperatorCredential, acceptOperatorCredential, fetchOperatorCredential,
  deleteOperatorCredential, type OperatorTerms,
} from '../xrpl/operator.js';
import {
  buildAcceptedCredentials, createPermissionedDomain, setupDepositPreauth, gateCheck,
} from '../xrpl/domain.js';
import { submitPaymentForApproval, approveAndRelease, rejectAndRefund } from '../xrpl/bankGate.js';
import { issueSkillCredential, acceptSkillCredential, fetchSkillCredential, skillContentHash } from '../xrpl/skillCredential.js';
import { AgentStore } from './agentStore.js';
import { DossierStore } from '../kya/dossier.js';
import { attestFiles } from '../agent/attest.js';
import { runCrossBorderScenario } from '../agent/scenario.js';
import { readFileSync } from 'node:fs';
import { rpSignatureHandler, verifyProofHandler } from '../worldid/backend.js';
import { checkPassportForX402, buildX402Response, type X402Requirements } from '../x402/gate.js';
import { buildAmlMatcher } from '../kya/aml.js';

const PAYMENTS_PATH = fileURLToPath(new URL('../../.payments.json', import.meta.url));
const AGENTS_PATH = fileURLToPath(new URL('../../.agents.json', import.meta.url));
const DOSSIERS_PATH = fileURLToPath(new URL('../../.dossiers.json', import.meta.url));
const HARNESS_PATH = fileURLToPath(new URL('../agent/sdk.ts', import.meta.url));
const SKILL_PATH = fileURLToPath(new URL('../agent/skills/payment-v1.ts', import.meta.url));
const did = (addr: string) => `did:xrpl:1:${addr}`;
const DEFAULT_OFFCHAIN: Partial<Signals> = {
  worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true,
};

// ── live event bus (SSE) ────────────────────────────────────────────
const sseClients: Response[] = [];
function emit(event: object) {
  const line = `data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}\n\n`;
  for (const r of sseClients) r.write(line);
}
const txEvent = (kind: string, label: string, hash: string, extra: object = {}) =>
  emit({ type: 'tx', kind, label, hash, url: CONFIG.explorerTx(hash), ...extra });

async function main() {
  const c: Client = await getClient();
  const treasury = await loadOrFund(c, 'treasury'); // MeshCredit bureau / credential issuer
  const bank = await loadOrFund(c, 'bank');         // relying party — owns the DepositAuth gate

  // The bank stands up its own gate once at startup (best-effort / idempotent).
  try {
    await setupDepositPreauth(c, bank, buildAcceptedCredentials(treasury.address));
    console.log('  bank gate ready (DepositAuth + DepositPreauth → MeshCredit credential)');
  } catch { /* already configured on a prior run */ }

  const store = new PaymentStore(PAYMENTS_PATH);
  const ATTESTATION = attestFiles(HARNESS_PATH, SKILL_PATH);
  const SKILL_BYTES = readFileSync(SKILL_PATH);
  const dossierStore = new DossierStore(DOSSIERS_PATH);
  const agentStore = new AgentStore(AGENTS_PATH);
  const agents = agentStore.loadAll(); // survives restarts

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, network: CONFIG.network, asset: assetLabel(), treasury: treasury.address, bank: bank.address });
  });

  // Create a fresh managed agent wallet (in production the agent brings its own).
  app.post('/api/agent/create', async (_req, res) => {
    try {
      const w = await fundNew(c, 'agent');
      agents.set(w.address, w);
      agentStore.add(w);
      emit({ type: 'agent_created', address: w.address, did: did(w.address) });
      res.json({ address: w.address, did: did(w.address) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Operator KYB onboarding ────────────────────────────────────────
  app.post('/api/operator/onboard', async (req, res) => {
    try {
      const { operatorAddr, kybSignals } = req.body as { operatorAddr: string; kybSignals: KybSignals };
      const { btier, maxDelegatedSpend } = kybScore(kybSignals);
      if (btier === 'DENIED') return res.status(403).json({ error: 'KYB denied — operator does not meet minimum criteria' });
      const terms: OperatorTerms = {
        v: 1, btier, maxDelegatedSpend,
        kybHash: dossierRef('kyb:' + operatorAddr), juris: kybSignals.registeredJurisdiction,
        exp: toRippleEpoch(Date.now()) + 365 * 24 * 3600,
      };
      const hash = await issueOperatorCredential(c, treasury, operatorAddr, terms);
      txEvent('CredentialCreate', 'OperatorCredential issued', hash, { btier, maxDelegatedSpend, operator: operatorAddr });
      const operatorWallet = agents.get(operatorAddr);
      if (operatorWallet) await acceptOperatorCredential(c, operatorWallet, treasury.address);
      res.json({ hash, btier, maxDelegatedSpend, operatorAddr });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/operator/verify', async (req, res) => {
    try {
      const { operatorAddr } = req.body as { operatorAddr: string };
      const view = await fetchOperatorCredential(c, operatorAddr, treasury.address);
      if (!view) return res.status(404).json({ verified: false, reason: 'no operator credential on ledger' });
      if (!view.accepted) return res.status(403).json({ verified: false, reason: 'operator credential not yet accepted' });
      res.json({ verified: true, operatorAddr, btier: view.terms.btier, maxDelegatedSpend: view.terms.maxDelegatedSpend, credId: view.credId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/operator/revoke', async (req, res) => {
    try {
      const { operatorAddr } = req.body as { operatorAddr: string };
      const hash = await deleteOperatorCredential(c, treasury, operatorAddr);
      txEvent('CredentialDelete', 'OperatorCredential revoked', hash, { operator: operatorAddr });
      res.json({ hash, operatorAddr });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Permissioned Domain (optional bureau-owned venue) ─────────────────
  app.post('/api/domain/create', async (_req, res) => {
    try {
      const { domainId, hash } = await createPermissionedDomain(c, treasury, buildAcceptedCredentials(treasury.address));
      txEvent('PermissionedDomainSet', 'PermissionedDomain created', hash, { domainId });
      res.json({ domainId, hash });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/domain/gate/:agentAddr?tier=TIER-1&amount=50 — read-only gate check.
  app.get('/api/domain/gate/:agentAddr', async (req, res) => {
    try {
      const requiredTier = ((req.query.tier as string) ?? 'TIER-1') as Tier;
      const amount = req.query.amount as string | undefined;
      const result = await gateCheck(c, req.params.agentAddr, treasury.address, requiredTier, amount ? { amount } : {});
      res.status(result.allowed ? 200 : 403).json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // KYA underwriting (off-chain inputs + on-chain XRPL signals) — no state change.
  app.post('/api/kya/evaluate', async (req, res) => {
    try {
      const { agentAddr, offChain } = req.body as { agentAddr: string; offChain?: Partial<Signals> };
      const r = await underwrite(c, agentAddr, { ...DEFAULT_OFFCHAIN, ...offChain }, { kyaSeed: 'mc:' + agentAddr });
      res.json({ decision: r.decision, signals: r.signals });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Bank-gate payment flow ────────────────────────────────────────────
  // POST /api/payment/initiate — certify (if needed) → gate-check (with amount)
  //   → lock funds in escrow to the bank's gated account ("held at the bank").
  //   Body: { agentAddr, recipientAddr, amount, travelRulePayload?, offChain? }
  app.post('/api/payment/initiate', async (req, res) => {
    try {
      const { agentAddr, recipientAddr, amount = '50', travelRulePayload = '{}', offChain } = req.body as {
        agentAddr: string; recipientAddr: string; amount?: string; travelRulePayload?: string; offChain?: Partial<Signals>;
      };
      const agent = agents.get(agentAddr);
      if (!agent) return res.status(400).json({ error: 'unknown managed agent; call /api/agent/create' });

      // KYA → issue/accept the trust credential if the agent has none yet.
      // Attest the agent's harness + skill bytes (real SHA-256).
      const attestation = ATTESTATION;
      // Link to the agent's operator (op8) if it holds an operator credential.
      const opView = await fetchOperatorCredential(c, agentAddr, treasury.address);
      const { decision, terms, dossier } = await underwrite(
        c, agentAddr, { ...DEFAULT_OFFCHAIN, ...offChain },
        { kyaSeed: 'mc:' + agentAddr, attestation, operatorCredId: opView?.credId, version: 2 },
      );
      if (decision.tier === 'DENIED') return res.status(403).json({ error: 'KYA denied', decision });
      dossierStore.put(dossier);
      let view = await fetchCredential(c, agentAddr, treasury.address);
      if (!view) {
        const createHash = await issueCredential(c, treasury, agentAddr, terms);
        await acceptCredential(c, agent, treasury.address);
        txEvent('CredentialCreate', 'AgentTrustCredential issued', createHash, { tier: decision.tier, ih: terms.ih, sh: terms.sh });
        view = await fetchCredential(c, agentAddr, treasury.address);
      }

      // Gate check WITH amount enforcement (maxTxAmount is not decorative).
      const gate = await gateCheck(c, agentAddr, treasury.address, 'TIER-1', { amount });
      if (!gate.allowed) return res.status(403).json({ error: gate.reason, gate });

      // Lock funds in escrow to the bank's gated account ("money on hold at the bank").
      const handle = await submitPaymentForApproval(c, agent, bank.address, xrpToDrops(amount), dossierRef('docs:' + agentAddr + ':' + recipientAddr));
      txEvent('EscrowCreate', `Payment ${amount} XRP held at bank`, handle.createHash, { recipient: recipientAddr });

      const pay = store.create({
        id: `pay-${handle.sequence}`, agentAddr, senderAddr: agentAddr, recipientAddr,
        amount, currency: 'XRP', escrowSequence: handle.sequence, condition: handle.condition,
        fulfillment: handle.fulfillment, status: 'pending_bank', travelRulePayload,
        createdAt: Date.now(), escrowHash: handle.createHash,
      });
      emit({ type: 'payment', payment: pay });
      res.json({ payment: pay, credId: view?.credId, gate });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/payment/approve — release into the gated account (needs the credential).
  app.post('/api/payment/approve', async (req, res) => {
    try {
      const { id } = req.body as { id: string };
      const pay = store.get(id);
      if (!pay) return res.status(404).json({ error: 'payment not found' });
      const agent = agents.get(pay.agentAddr);
      const view = await fetchCredential(c, pay.agentAddr, treasury.address);
      if (!agent || !view) return res.status(400).json({ error: 'agent key or credential unavailable' });
      const handle: any = { sequence: pay.escrowSequence, condition: pay.condition, fulfillment: pay.fulfillment };
      const finishHash = await approveAndRelease(c, agent, pay.agentAddr, handle, [view.credId]);
      txEvent('EscrowFinish', `Bank approved → released ${pay.amount} XRP`, finishHash, { recipient: pay.recipientAddr });
      const updated = store.update(id, { status: 'released', finishHash });
      emit({ type: 'payment_update', payment: updated });
      res.json({ finishHash, payment: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/payment/reject — cancel the escrow → funds refund to the sender.
  app.post('/api/payment/reject', async (req, res) => {
    try {
      const { id } = req.body as { id: string };
      const pay = store.get(id);
      if (!pay) return res.status(404).json({ error: 'payment not found' });
      const agent = agents.get(pay.agentAddr);
      if (!agent) return res.status(400).json({ error: 'agent key unavailable' });
      const handle: any = { sequence: pay.escrowSequence, condition: pay.condition, fulfillment: pay.fulfillment };
      const cancelHash = await rejectAndRefund(c, agent, pay.agentAddr, handle);
      txEvent('EscrowCancel', `Rejected → refunded ${pay.amount} XRP to sender`, cancelHash);
      const updated = store.update(id, { status: 'refunded' });
      res.json({ cancelHash, payment: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/payments', (_req, res) => res.json({ payments: store.all() }));

  // ── Kill-switch: revoke the on-ledger credential (denies everywhere at once) ──
  app.post('/api/killswitch', async (req, res) => {
    try {
      const { agentAddr } = req.body as { agentAddr: string };
      const killHash = await revokeCredential(c, treasury, agentAddr);
      txEvent('CredentialDelete', 'Kill-switch — credential revoked', killHash, { agent: agentAddr });
      emit({ type: 'killswitch', agentAddr });
      res.json({ killHash });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Skill credentials (UC2) ───────────────────────────────────────────
  app.post('/api/skill/certify', async (req, res) => {
    try {
      const { agentAddr, skillId, skillVersion = '1.0.0' } = req.body as { agentAddr: string; skillId: string; skillVersion?: string };
      const agent = agents.get(agentAddr);
      if (!agent) return res.status(400).json({ error: 'unknown managed agent' });
      const terms = {
        v: 1 as const, skillId, skillVersion,
        benchmarkHash: skillContentHash(SKILL_BYTES),
        exp: toRippleEpoch(Date.now()) + 365 * 24 * 3600,
      };
      const hash = await issueSkillCredential(c, treasury, agentAddr, terms);
      await acceptSkillCredential(c, agent, treasury.address);
      txEvent('CredentialCreate', `Skill certified: ${skillId}`, hash, { skillId });
      res.json({ hash, skillId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/skill/:agentAddr', async (req, res) => {
    try {
      const skill = await fetchSkillCredential(c, req.params.agentAddr, treasury.address);
      res.json({ agentAddr: req.params.agentAddr, skill });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Public Credit-Bureau lookup — works for ANY agent address ─────────
  app.get('/api/credential/:agentAddr', async (req, res) => {
    try {
      const view = await fetchCredential(c, req.params.agentAddr, treasury.address);
      res.json({ agentAddr: req.params.agentAddr, did: did(req.params.agentAddr), issuer: treasury.address, credential: view });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Per-pull dossier lookup — the off-chain risk narrative behind a credential's ref.
  app.get('/api/dossier/:ref', (req: Request, res: Response) => {
    try {
      const d = dossierStore.get(req.params.ref);
      if (!d) return res.status(404).json({ error: 'dossier not found', ref: req.params.ref });
      res.json({ dossier: d });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── World ID IDKit v4 backend routes (D2 Human Accountability) ───────────
  // POST /api/worldid/rp-signature — calls signRequest; honest fallback when key absent.
  app.post('/api/worldid/rp-signature', rpSignatureHandler);
  // POST /api/worldid/verify — forwards to developer.world.org/api/v4/verify/{rp_id}.
  app.post('/api/worldid/verify', verifyProofHandler);

  // ── Phase 1.5 — x402 gate demo endpoint ──────────────────────────────────
  // POST /api/x402/resource — returns 402 with requirements if the agent's
  // credential is absent, invalid, or AML-flagged; returns 200 on pass.
  //
  // Request body: { agentAddr, requestedAmount? }
  // The resource's requirements are fixed here for the demo.
  const x402Requirements: X402Requirements = {
    amount: '50',         // demo ceiling: 50 RLUSD
    currency: 'RLUSD',
    credentialIssuer: treasury.address,
    requiredTier: 'BRONZE',
    paymentAddress: treasury.address,
  };
  const x402AmlMatcher = buildAmlMatcher();

  app.post('/api/x402/resource', async (req, res) => {
    try {
      const { agentAddr, requestedAmount } = req.body as { agentAddr?: string; requestedAmount?: string };
      if (!agentAddr) {
        const r402 = buildX402Response(x402Requirements);
        return res.status(402).set(r402.headers).json({ ...r402.body, reason: 'no agent address provided' });
      }

      // Fetch the on-ledger credential for this agent.
      const credView = await fetchCredential(c, agentAddr, treasury.address).catch(() => null);
      const credentialStatus: 'valid' | 'missing' | 'revoked' =
        !credView ? 'missing' : credView.accepted ? 'valid' : 'missing';

      // AML screen the agent address (the agent's address is the identity being screened).
      const amlScreening = x402AmlMatcher(agentAddr);

      // Run the x402 gate.
      const gateResult = await checkPassportForX402({
        agentAddr,
        credentialStatus,
        tierCeiling: x402Requirements.amount,
        requestedAmount: requestedAmount ?? x402Requirements.amount,
        amlResult: amlScreening.action,
      });

      if (!gateResult.allowed) {
        const r402 = buildX402Response(x402Requirements);
        return res.status(402).set(r402.headers).json({ ...r402.body, reason: gateResult.reason });
      }

      // Resource released.
      res.json({ content: 'resource released', agentAddr, credentialStatus });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Cinematic cross-border scenario — streamed step-by-step over SSE ───
  // Kicks off the full real-testnet arc (KYB → KYA → gate → real LLM risk
  // decision → FX → escrow → certified release → uncertified denial → code-swap
  // → kill-switch). Progress arrives as {type:'step'} / {type:'demo_done'} events.
  let demoRunning = false;
  app.post('/api/demo/run', (_req, res) => {
    if (demoRunning) return res.status(409).json({ error: 'a demo run is already in progress' });
    demoRunning = true;
    emit({ type: 'demo_accepted' });
    res.json({ started: true });
    runCrossBorderScenario({ c, treasury, emit, harnessPath: HARNESS_PATH, skillPath: SKILL_PATH })
      .catch((e) => emit({ type: 'demo_done', ok: false, error: String(e?.message ?? e) }))
      .finally(() => { demoRunning = false; });
  });

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'hello', treasury: treasury.address, bank: bank.address })}\n\n`);
    sseClients.push(res);
    req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
  });

  app.listen(CONFIG.port, () => {
    console.log(`MeshCredit treasury server on http://localhost:${CONFIG.port}`);
    console.log(`  network=${CONFIG.network}  asset=${assetLabel()}`);
    console.log(`  treasury(bureau)=${treasury.address}`);
    console.log(`  bank(gate)=${bank.address}`);
  });
}

main().catch((e) => { console.error('server failed:', e); process.exit(1); });
