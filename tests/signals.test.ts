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
});
