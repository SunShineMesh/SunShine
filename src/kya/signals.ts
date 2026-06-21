// On-chain (XRPL) signal ingestion for KYA. Best-effort: a brand-new agent
// returns near-zero signals, which is correct (no history yet).
import { type Client } from 'xrpl';
import { type Signals } from './scorecard.js';

const RIPPLE_EPOCH = 946684800;

export async function readOnChainSignals(c: Client, agentAddr: string): Promise<Partial<Signals>> {
  try {
    // Counts come from the most-recent window. KNOWN LIMITS (documented, not fixed
    // here): (1) payment count is asset-unfiltered; (2) escrow completion rate is
    // self-referential (create vs finish in the same window). Both are acceptable
    // for the demo and superseded by bureau-attested signals in production.
    const txs: any = await c.request({
      command: 'account_tx', account: agentAddr, limit: 200, ledger_index_min: -1, ledger_index_max: -1,
    } as any);
    const rows: any[] = txs.result.transactions ?? [];
    let payments = 0, escrowCreate = 0, escrowFinish = 0;
    for (const r of rows) {
      const tt = (r.tx ?? r.tx_json ?? {}).TransactionType;
      if (tt === 'Payment') payments++;
      else if (tt === 'EscrowCreate') escrowCreate++;
      else if (tt === 'EscrowFinish') escrowFinish++;
    }
    const escrowCompletionRate = escrowCreate > 0 ? Math.min(escrowFinish / escrowCreate, 1) : 0;

    // Account age from the FIRST (oldest) transaction — robust for > 200-tx accounts,
    // unlike taking the min date of the most-recent descending window.
    const first: any = await c.request({ command: 'account_tx', account: agentAddr, limit: 1, forward: true } as any);
    const firstRow = (first.result.transactions ?? [])[0];
    const genesisDate = firstRow ? (firstRow.tx?.date ?? firstRow.tx_json?.date) : undefined;
    const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
    const accountAgeDays = typeof genesisDate === 'number' ? Math.max(0, (nowRipple - genesisDate) / 86400) : 0;

    return { rlusdPayments: payments, escrowCompletionRate, accountAgeDays };
  } catch {
    return {};
  }
}
