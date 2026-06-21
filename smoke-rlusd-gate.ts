// SMOKE (Option B) — real testnet RLUSD through the credential-gated DepositAuth
// account, using the PERSISTENT demoAgent wallet (.wallets.json) the human faucets
// at tryrlusd.com. Reads the RLUSD issuer off demoAgent's trustline — no hard-coded
// issuer. Non-blocking: if demoAgent holds no RLUSD trustline yet, it explains the
// faucet step and exits 0. Generalizes spike-payment-gate.ts to real RLUSD.
//   npm run smoke:rlusd-gate
import { type Client } from 'xrpl';
import { getClient, closeClient, submit } from './src/xrpl/client.js';
import { loadOrFund, fundNew } from './src/xrpl/wallets.js';
import { underwrite } from './src/kya/underwrite.js';
import { issueCredential, acceptCredential, fetchCredential } from './src/xrpl/credential.js';
import { buildAcceptedCredentials, setupDepositPreauth } from './src/xrpl/domain.js';
import { attestFiles } from './src/agent/attest.js';
import { CONFIG } from './src/config.js';
import { fileURLToPath } from 'node:url';

const line = (s = '') => console.log(s);
const tec = (e: any): string => ((e?.message || String(e)).match(/te[a-z][A-Z_]+/) || ['THROWN'])[0];

async function rlusdLine(c: Client, addr: string): Promise<{ currency: string; issuer: string } | null> {
  const r: any = await c.request({ command: 'account_lines', account: addr, ledger_index: 'validated' });
  const l = (r.result.lines || []).find((x: any) =>
    x.currency.includes('524C555344') || x.currency === 'RLUSD' || x.currency.startsWith('524C')
  );
  return l ? { currency: l.currency, issuer: l.account } : null;
}

async function main() {
  const c = await getClient();
  const treasury = await loadOrFund(c, 'treasury');
  const bank = await loadOrFund(c, 'bank');
  const demoAgent = await loadOrFund(c, 'demoAgent');
  line(`\nnetwork=${CONFIG.network}`);
  line(`demoAgent=${demoAgent.address}`);

  const asset = await rlusdLine(c, demoAgent.address);
  if (!asset) {
    line('\n⏭  demoAgent holds no funded RLUSD trustline yet.');
    line(`   Faucet real testnet RLUSD to ${demoAgent.address} at https://tryrlusd.com/ then rerun.`);
    await closeClient();
    return; // non-blocking skip
  }
  line(`RLUSD asset: currency=${asset.currency} issuer=${asset.issuer}`);

  // Bank stands up its gate + opens an RLUSD trustline to the same issuer.
  await setupDepositPreauth(c, bank, buildAcceptedCredentials(treasury.address));
  await submit(c, bank, { TransactionType: 'TrustSet', Account: bank.address, LimitAmount: { currency: asset.currency, issuer: asset.issuer, value: '1000000' } }, 'bank RLUSD trustline');

  // Certify demoAgent (v2 attested cert).
  const harness = fileURLToPath(new URL('./src/agent/sdk.ts', import.meta.url));
  const skill = fileURLToPath(new URL('./src/agent/skills/payment-v1.ts', import.meta.url));
  const { terms } = await underwrite(c, demoAgent.address,
    { worldId: true, runtimeStable: true, transcriptCoherent: true, sourceProvided: true, humanDidComplete: true, operatorBacked: true },
    { attestation: attestFiles(harness, skill), version: 2 });
  if (!(await fetchCredential(c, demoAgent.address, treasury.address))) {
    await issueCredential(c, treasury, demoAgent.address, terms);
    await acceptCredential(c, demoAgent, treasury.address);
  }
  const view = await fetchCredential(c, demoAgent.address, treasury.address);

  // A — certified RLUSD Payment + CredentialIDs → clears the gate.
  let aCode = 'THROWN';
  try {
    const r = await submit(c, demoAgent, {
      TransactionType: 'Payment', Account: demoAgent.address, Destination: bank.address,
      Amount: { currency: asset.currency, issuer: asset.issuer, value: '5' }, CredentialIDs: [view!.credId],
    }, 'certified RLUSD Payment');
    aCode = 'tesSUCCESS'; line(`A certified RLUSD Payment → ${aCode}  ${CONFIG.explorerTx(r.hash)}`);
  } catch (e) { aCode = tec(e); line(`A certified RLUSD Payment → ${aCode}`); }

  // B — uncertified agent (fresh) → tecNO_PERMISSION. (Needs its own RLUSD; if it
  // can't hold the asset the gate still blocks first.)
  const bad = await fundNew(c, 'badAgent');
  let bCode = 'THROWN';
  try {
    await submit(c, bad, {
      TransactionType: 'Payment', Account: bad.address, Destination: bank.address,
      Amount: { currency: asset.currency, issuer: asset.issuer, value: '5' },
    }, 'uncertified RLUSD Payment');
    bCode = 'tesSUCCESS';
  } catch (e) { bCode = tec(e); }
  line(`B uncertified RLUSD Payment → ${bCode}`);

  const ok = aCode === 'tesSUCCESS' && bCode === 'tecNO_PERMISSION';
  line(`\nOPTION-B GATE: ${ok ? 'CONFIRMED ✅ real RLUSD clears only with the credential' : 'CHECK ❌'}`);
  await closeClient();
  if (!ok) process.exitCode = 1;
}
main().catch(async (e) => { console.error('SMOKE ERROR:', e?.message || e); await closeClient(); process.exitCode = 1; });
