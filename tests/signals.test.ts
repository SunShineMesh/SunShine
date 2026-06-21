import { describe, it, expect } from 'vitest';
import { readOnChainSignals } from '../src/kya/signals.js';

const RIPPLE_EPOCH = 946684800;
const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;

// Fake client: forward:true query returns the OLDEST tx (genesis); the default
// (descending) query returns a recent window used only for counts.
function fakeClient(genesisRippleDate: number, recent: any[]) {
  return {
    request: async (req: any) => {
      if (req.command === 'account_tx' && req.forward === true) {
        return { result: { transactions: [{ tx: { TransactionType: 'Payment', date: genesisRippleDate } }] } };
      }
      if (req.command === 'account_tx') {
        return { result: { transactions: recent } };
      }
      throw new Error('unexpected request ' + req.command);
    },
  } as any;
}

describe('readOnChainSignals', () => {
  it('derives account age from the FIRST tx, not the most-recent window', async () => {
    const genesis = nowRipple - 90 * 86400; // 90 days ago
    const s = await readOnChainSignals(fakeClient(genesis, []), 'rX');
    expect(s.accountAgeDays).toBeGreaterThanOrEqual(89);
    expect(s.accountAgeDays).toBeLessThanOrEqual(91);
  });
  it('counts payments and computes escrow completion rate from the window', async () => {
    const genesis = nowRipple - 10 * 86400;
    const recent = [
      { tx: { TransactionType: 'Payment' } },
      { tx: { TransactionType: 'EscrowCreate' } },
      { tx: { TransactionType: 'EscrowFinish' } },
    ];
    const s = await readOnChainSignals(fakeClient(genesis, recent), 'rX');
    expect(s.rlusdPayments).toBe(1);
    expect(s.escrowCompletionRate).toBe(1);
  });
  it('returns {} on RPC error (brand-new / unknown account)', async () => {
    const c = { request: async () => { throw new Error('actNotFound'); } } as any;
    expect(await readOnChainSignals(c, 'rX')).toEqual({});
  });

  // D4 third-party-only filter (Sybil fix)
  it('excludes self-payment (dest == agentAddr) from rlusdPayments', async () => {
    const genesis = nowRipple - 30 * 86400;
    const recentDate = nowRipple - 1 * 86400; // 1 day ago — within 90d window
    const recent = [
      // self-loop: destination is the agent itself → must NOT be counted
      { tx: { TransactionType: 'Payment', Destination: 'rAGENT', date: recentDate } },
      // third-party payment → must be counted
      { tx: { TransactionType: 'Payment', Destination: 'rOTHER', date: recentDate } },
    ];
    const s = await readOnChainSignals(fakeClient(genesis, recent), 'rAGENT');
    expect(s.rlusdPayments).toBe(1);
  });

  it('excludes EscrowFinish where destination is the agent itself', async () => {
    const genesis = nowRipple - 30 * 86400;
    const recentDate = nowRipple - 1 * 86400;
    const recent = [
      // self-finish: escrow finishes back to the agent → must NOT count
      { tx: { TransactionType: 'EscrowFinish', Destination: 'rAGENT', date: recentDate } },
      // third-party escrow finish → must count
      { tx: { TransactionType: 'EscrowFinish', Destination: 'rSUPPLIER', date: recentDate } },
      // escrow create (needed for completion rate denominator)
      { tx: { TransactionType: 'EscrowCreate', date: recentDate } },
    ];
    const s = await readOnChainSignals(fakeClient(genesis, recent), 'rAGENT');
    // Only 1 of 2 EscrowFinishes counts as third-party; EscrowCreate = 1
    // escrowCompletionRate = min(thirdPartyFinish / escrowCreate, 1) = min(1/1, 1) = 1
    expect(s.escrowCompletionRate).toBe(1);
  });

  it('excludes transactions older than 90 days from behavioral counts', async () => {
    const genesis = nowRipple - 120 * 86400;
    const oldDate = nowRipple - 91 * 86400; // 91 days ago — outside the 90d window
    const recentDate = nowRipple - 1 * 86400; // 1 day ago — inside window
    const recent = [
      // old tx (outside window) → must NOT count
      { tx: { TransactionType: 'Payment', Destination: 'rOTHER', date: oldDate } },
      // recent third-party tx → must count
      { tx: { TransactionType: 'Payment', Destination: 'rOTHER', date: recentDate } },
    ];
    const s = await readOnChainSignals(fakeClient(genesis, recent), 'rAGENT');
    expect(s.rlusdPayments).toBe(1);
  });

  it('counts 5 real third-party payments as rlusdPayments === 5', async () => {
    const genesis = nowRipple - 30 * 86400;
    const recentDate = nowRipple - 1 * 86400;
    const recent = Array.from({ length: 5 }, () => ({
      tx: { TransactionType: 'Payment', Destination: 'rSUPPLIER', date: recentDate },
    }));
    const s = await readOnChainSignals(fakeClient(genesis, recent), 'rAGENT');
    expect(s.rlusdPayments).toBe(5);
  });
});
