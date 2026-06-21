// Live XLS-85 token-escrow proof on XRPL testnet — the "one-flag-from-mainnet"
// claim, executed end to end:
//   issuer (asfAllowTrustLineLocking set) -> trustlines -> agent EscrowCreate(IOU)
//   -> agent EscrowFinish(reveal secret) -> the IOU lands in the treasury.
//
//   npm run test:testnet
import { describe, it, expect } from 'vitest';
import { getClient, closeClient } from '../src/xrpl/client.js';
import { fundNew } from '../src/xrpl/wallets.js';
import { setupStablecoin, trustAndFund, establishTrustline, iouAmount } from '../src/xrpl/stablecoin.js';
import { createPaymentEscrow, finishEscrow } from '../src/xrpl/escrow.js';
import { CONFIG } from '../src/config.js';

async function iouBalance(c: any, account: string, issuer: string, currency = 'USD'): Promise<number> {
  const r: any = await c.request({ command: 'account_lines', account, peer: issuer, ledger_index: 'validated' });
  const line = r.result.lines.find((l: any) => l.currency === currency);
  return line ? Number(line.balance) : 0;
}

describe('XLS-85 token escrow (testnet)', () => {
  it('agent escrows an IOU and autonomously releases it to the treasury', async () => {
    const c = await getClient();
    try {
      const issuer = await fundNew(c, 'escrow-issuer');
      const treasury = await fundNew(c, 'escrow-treasury');
      const agent = await fundNew(c, 'escrow-agent');

      // Issuer becomes a lockable stablecoin issuer (the single flag mainnet RLUSD lacks).
      await setupStablecoin(c, issuer);
      await establishTrustline(c, issuer, treasury); // treasury can receive the IOU
      await trustAndFund(c, issuer, agent, '50');     // agent holds 50 USD (its task earnings)

      const treasuryBefore = await iouBalance(c, treasury.address, issuer.address);
      const agentBefore = await iouBalance(c, agent.address, issuer.address);
      expect(agentBefore).toBeCloseTo(50, 6);

      // Agent locks a 10 USD repayment in escrow, gated by a fresh crypto-condition.
      const handle = await createPaymentEscrow(c, agent, treasury.address, iouAmount('10', issuer.address));
      expect(handle.createHash).toMatch(/^[0-9A-F]{64}$/);
      expect(handle.condition).toMatch(/^A025/); // PREIMAGE-SHA-256 condition

      // Agent reveals the secret to release it — no human, no dashboard.
      const finishHash = await finishEscrow(c, agent, agent.address, handle);
      expect(finishHash).toMatch(/^[0-9A-F]{64}$/);

      // After release: the 10 USD has moved agent -> treasury.
      const treasuryAfter = await iouBalance(c, treasury.address, issuer.address);
      const agentAfter = await iouBalance(c, agent.address, issuer.address);
      expect(treasuryAfter - treasuryBefore).toBeCloseTo(10, 6);
      expect(agentAfter).toBeCloseTo(40, 6);

      // Surface the real hashes for the dossier.
      console.log('\n  XLS-85 token escrow — verified on testnet:');
      console.log(`    issuer (flag set): ${CONFIG.explorerAcct(issuer.address)}`);
      console.log(`    EscrowCreate: ${CONFIG.explorerTx(handle.createHash)}`);
      console.log(`    EscrowFinish: ${CONFIG.explorerTx(finishHash)}`);
      console.log(`    treasury IOU balance: ${treasuryBefore} -> ${treasuryAfter}\n`);
    } finally {
      await closeClient();
    }
  });
});
