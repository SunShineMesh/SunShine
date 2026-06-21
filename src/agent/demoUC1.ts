// MeshCredit UC1 — the cross-border agent-payment trust-bureau demo.
// Alice's agent sends money to Bob through a bank that gates its settlement
// account on a MeshCredit trust credential. A trustworthy agent is fast-tracked;
// an untrustworthy one is declined BY THE LEDGER before the bank ever sees it.
// Runs the full arc on XRPL testnet and prints an explorer link for every tx.
//   npm run demo
import { Client } from 'xrpl';
import { getClient, closeClient } from '../xrpl/client.js';
import { fundNew } from '../xrpl/wallets.js';
import { toRippleEpoch, dossierRef, type TrustTerms } from '../xrpl/codec.js';
import { issueCredential, acceptCredential, fetchCredential, revokeCredential } from '../xrpl/credential.js';
import { underwrite } from '../kya/underwrite.js';
import { buildAcceptedCredentials, setupDepositPreauth, gateCheck } from '../xrpl/domain.js';
import { submitPaymentForApproval, approveAndRelease } from '../xrpl/bankGate.js';
import { seedOfferBook, swapViaPathPayment } from '../xrpl/dex.js';
import { setupStablecoin, trustAndFund, establishTrustline, iouAmount } from '../xrpl/stablecoin.js';
import { issueSkillCredential, acceptSkillCredential, fetchSkillCredential, type SkillTerms } from '../xrpl/skillCredential.js';
import { submit } from '../xrpl/client.js';
import { CONFIG } from '../config.js';
import { issueOperatorCredential, acceptOperatorCredential, fetchOperatorCredential, type OperatorTerms } from '../xrpl/operator.js';
import { kybScore, type KybSignals } from '../kya/kyb.js';
import { verifyAttestation, attestFiles } from '../agent/attest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(70));
const tx = (label: string, h: string) => line(`   ${label}: ${CONFIG.explorerTx(h)}`);
const tecOf = (e: any): string => ((e?.message || String(e)).match(/te[a-z][A-Z_]+/) || ['?'])[0];

async function xrpBal(c: Client, addr: string): Promise<number> {
  const r: any = await c.request({ command: 'account_info', account: addr, ledger_index: 'validated' });
  return Number(r.result.account_data.Balance);
}

async function main() {
  line('\n╔══════════════════════════════════════════════════════════════════╗');
  line('║  MeshCredit — trust bureau for cross-border agent payments (XRPL) ║');
  line('╚══════════════════════════════════════════════════════════════════╝');

  const c = await getClient();
  line('\n[setup] funding demo wallets on testnet…');
  const meshcredit = await fundNew(c, 'meshcredit'); // the bureau / credential issuer
  const bank = await fundNew(c, 'bank');             // relying party — owns the gated settlement account
  const agent = await fundNew(c, 'agent');           // Alice's agent (the payer)
  const bob = await fundNew(c, 'bob');               // the beneficiary
  const badAgent = await fundNew(c, 'badAgent');     // an uncertified agent (the contrast)
  const operator = await fundNew(c, 'operator'); // Helvetia Components AG (KYB'd legal entity)
  line(`   MeshCredit (bureau): ${meshcredit.address}`);
  line(`   bank (owns gate)   : ${bank.address}`);
  line(`   Alice's agent      : ${agent.address}`);
  line(`   Bob (beneficiary)  : ${bob.address}`);
  line(`   operator (Helvetia): ${operator.address}`);

  // ── 1b. MeshCredit KYBs the operator (Helvetia) ──────────────────────
  hr(); line('1b) MeshCredit KYBs the operator (Helvetia) → operator_v1 delegation credential.');
  const kyb: KybSignals = { entityVerified: true, businessAgeDays: 1460, registeredJurisdiction: 'CH', operatorSettlementRate: 0.9 };
  const { btier, maxDelegatedSpend } = kybScore(kyb);
  const opTerms: OperatorTerms = {
    v: 1, btier, maxDelegatedSpend, kybHash: dossierRef('kyb:' + operator.address), juris: 'CH',
    exp: toRippleEpoch(Date.now()) + 365 * 86400,
  };
  const opHash = await issueOperatorCredential(c, meshcredit, operator.address, opTerms);
  await acceptOperatorCredential(c, operator, meshcredit.address);
  const opView = await fetchOperatorCredential(c, operator.address, meshcredit.address);
  tx('OperatorCredentialCreate', opHash);
  line(`   operator KYB → btier ${btier} · maxDelegatedSpend $${maxDelegatedSpend} · credId ${opView?.credId}`);

  // ── 1. The bank stands up ITS OWN gate ────────────────────────────────
  hr(); line("1) The BANK gates its settlement account to require a MeshCredit credential.");
  const gate = await setupDepositPreauth(c, bank, buildAcceptedCredentials(meshcredit.address));
  tx('AccountSet(asfDepositAuth)', gate.accountSetHash);
  tx('DepositPreauth(AuthorizeCredentials)', gate.preauthHash);
  line('   MeshCredit issues the credential; the bank decides to honor it (FICO model).');

  // ── 2. MeshCredit certifies Alice's agent (KYA, operator-backed, v2 attested) ─
  hr(); line('2) MeshCredit runs KYA (operator-backed) and issues a v2 attested AgentTrustCredential.');
  const harnessPath = fileURLToPath(new URL('./sdk.ts', import.meta.url));
  const skillPath = fileURLToPath(new URL('./skills/payment-v1.ts', import.meta.url));
  const attestation = attestFiles(harnessPath, skillPath);
  const kya = await underwrite(c, agent.address,
    { worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true },
    { kyaSeed: 'demo:' + agent.address, attestation, operatorCredId: opView?.credId, version: 2 });
  const issueHash = await issueCredential(c, meshcredit, agent.address, kya.terms);
  await acceptCredential(c, agent, meshcredit.address);
  const view = await fetchCredential(c, agent.address, meshcredit.address);
  tx('CredentialCreate', issueHash);
  line(`   score ${kya.decision.score} · tier ${view?.terms.tier} · maxTxAmount $${view?.terms.maxTxAmount} · ih ${view?.terms.ih} · sh ${view?.terms.sh} · op ${view?.terms.op}`);
  line(`   on-ledger credId: ${view?.credId} (anyone can read it — no API key)`);

  // ── 3. The DEX converts Alice's currency ──────────────────────────────
  hr(); line('3) Alice\'s funds are converted on the XRPL DEX (cross-currency).');
  const issuerA = await fundNew(c, 'issuerA');
  const issuerB = await fundNew(c, 'issuerB');
  const maker = await fundNew(c, 'maker');
  await setupStablecoin(c, issuerA); await setupStablecoin(c, issuerB);
  await trustAndFund(c, issuerA, agent, '200', 'USD');  // agent holds source ccy (RLUSD stand-in)
  await establishTrustline(c, issuerB, agent, 'EUR');   // agent can receive dest ccy
  await trustAndFund(c, issuerB, maker, '200', 'EUR');  // market maker holds EUR
  await establishTrustline(c, issuerA, maker, 'USD');
  await seedOfferBook(c, maker, iouAmount('100', issuerB.address, 'EUR'), iouAmount('100', issuerA.address, 'USD'));
  const swapHash = await swapViaPathPayment(c, agent, agent.address,
    iouAmount('101', issuerA.address, 'USD'), iouAmount('100', issuerB.address, 'EUR'));
  tx('DEX path payment (USD→EUR)', swapHash);
  line('   auto-routed through the order book — no MeshCredit involvement.');

  // ── 4. The money goes "on hold at the bank" (escrow) ──────────────────
  hr(); line('4) The agent escrows the settlement into the bank\'s gated account.');
  line('   Bob can see the funds are committed and held at the bank.');
  const bankBefore = await xrpBal(c, bank.address);
  const handle = await submitPaymentForApproval(c, agent, bank.address, '50000000', dossierRef('docs:alice-bob'));
  tx('EscrowCreate (held at bank)', handle.createHash);

  // ── 5. Gate check — trustworthy agent → fast-track ────────────────────
  hr(); line('5) The bank\'s gate checks the agent\'s credential (incl. amount).');
  const g = await gateCheck(c, agent.address, meshcredit.address, 'TIER-1', { amount: '50' });
  line(`   gate: allowed=${g.allowed}  tier=${g.tier}  reason=${g.reason}`);

  // ── 6. Bank approves → money flows to Bob ─────────────────────────────
  hr(); line('6) Certified → the bank fast-tracks: release, then funds flow to Bob.');
  const releaseHash = await approveAndRelease(c, agent, agent.address, handle, [view!.credId]);
  tx('EscrowFinish (released to bank)', releaseHash);
  const bankAfter = await xrpBal(c, bank.address);
  const toBob = await submit(c, bank, { TransactionType: 'Payment', Account: bank.address, Destination: bob.address, Amount: '50000000' }, 'Bank→Bob');
  tx('Payment (bank → Bob)', toBob.hash);
  line(`   bank received ${(bankAfter - bankBefore) / 1e6} XRP from escrow, forwarded to Bob.`);

  // ── 4b. Code-swap detection ────────────────────────────────────────────
  hr(); line('4b) Code-swap caught: a tampered skill no longer matches the on-ledger sh.');
  const audited = readFileSync(skillPath);
  const tampered = Buffer.from(audited.toString('utf8').replace('escrow', 'drain-EVIL'), 'utf8');
  const good = verifyAttestation(readFileSync(harnessPath), audited, attestation);
  const swap = verifyAttestation(readFileSync(harnessPath), tampered, attestation);
  line(`   audited runtime  → recognized=${good.recognized}`);
  line(`   tampered runtime → recognized=${swap.recognized}  (${swap.reason}) → disposition R / deny`);

  // ── 7. The contrast: an untrustworthy agent is declined before the bank ─
  hr(); line('7) An UNcertified agent attempts the same payment.');
  const badHandle = await submitPaymentForApproval(c, badAgent, bank.address, '50000000', dossierRef('docs:bad'));
  tx('EscrowCreate (uncertified)', badHandle.createHash);
  let declined = false;
  try {
    await approveAndRelease(c, badAgent, badAgent.address, badHandle, []);
    line('   (!) unexpectedly released');
  } catch (e) {
    declined = tecOf(e) === 'tecNO_PERMISSION';
    line(`   release → ${tecOf(e)} — DECLINED by the ledger before the bank's queue.`);
  }

  // ── 8. UC2 — the same credential rail attests a skill ─────────────────
  hr(); line('8) The same rail attests a specialized SKILL (the agent-skills economy).');
  const sterms: SkillTerms = { v: 1, skillId: 'invoice-reconciliation', skillVersion: '1.0.0', benchmarkHash: dossierRef('bench:inv'), exp: toRippleEpoch(Date.now()) + 365 * 86400 };
  const skillHash = await issueSkillCredential(c, meshcredit, agent.address, sterms);
  await acceptSkillCredential(c, agent, meshcredit.address);
  const skill = await fetchSkillCredential(c, agent.address, meshcredit.address);
  tx('SkillCredentialCreate', skillHash);
  line(`   Alice's agent now holds TWO on-ledger credentials: trust + skill (${skill?.terms.skillId}).`);

  // ── 9. Kill-switch ────────────────────────────────────────────────────
  hr(); line('9) Compromised agent? Revoke the credential — denied everywhere at once.');
  const killHash = await revokeCredential(c, meshcredit, agent.address);
  tx('CredentialDelete (kill-switch)', killHash);
  const gAfter = await gateCheck(c, agent.address, meshcredit.address, 'TIER-1', { amount: '50' });
  line(`   gate after revoke: allowed=${gAfter.allowed}  (${gAfter.reason})`);
  line('   in-flight escrows refund to the sender at CancelAfter — the bureau never seizes funds.');

  hr();
  const ok = g.allowed === true && declined === true && !!skill?.accepted && gAfter.allowed === false
    && (bankAfter - bankBefore) === 50000000 && good.recognized === true && swap.recognized === false && !!opView?.accepted;
  line(`RESULT: ${ok ? 'PASS ✅  trustworthy agent fast-tracked to Bob; untrustworthy declined before the bank' : 'FAIL ❌'}`);
  hr();

  await closeClient();
  if (!ok) process.exitCode = 1;
}

main().catch(async (e) => { console.error('\nDEMO FAILED:', e?.message || e); await closeClient(); process.exitCode = 1; });
