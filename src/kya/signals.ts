// On-chain (XRPL) signal ingestion for KYA. Best-effort: a brand-new agent
// returns near-zero signals, which is correct (no history yet).
import { type Client } from 'xrpl';
import { type Signals } from './scorecard.js';

const RIPPLE_EPOCH = 946684800;

// DERIVATION: behavioral record = {Payments to addresses ≠ agentAddr within 90d window}
// + {EscrowFinishes where Destination ≠ agentAddr within 90d window}.
// Re-derivable from public XRPL using account_tx with date range.
// Self-loops (dest == agentAddr) are excluded to prevent Sybil inflation of settlement count.
// Transactions with no date field are treated as within the window (conservative: don't
// penalise agents whose txs lack a date in the RPC response).

export async function readOnChainSignals(c: Client, agentAddr: string): Promise<Partial<Signals>> {
  try {
    const txs: any = await c.request({
      command: 'account_tx', account: agentAddr, limit: 200, ledger_index_min: -1, ledger_index_max: -1,
    } as any);
    const rows: any[] = txs.result.transactions ?? [];
    const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
    const windowStart = nowRipple - 90 * 86400;

    let payments = 0, escrowCreate = 0, escrowFinish = 0;
    for (const r of rows) {
      const tx = r.tx ?? r.tx_json ?? {};
      const tt: string = tx.TransactionType;
      const dest: string | undefined = tx.Destination;
      const txDate: number | undefined = tx.date;

      // 90-day window filter: if date is set and is outside the window, skip.
      const inWindow = typeof txDate !== 'number' || txDate >= windowStart;
      if (!inWindow) continue;

      if (tt === 'Payment') {
        // Third-party-only: exclude self-loops
        if (dest !== agentAddr) payments++;
      } else if (tt === 'EscrowCreate') {
        escrowCreate++;
      } else if (tt === 'EscrowFinish') {
        // Third-party-only: exclude self-directed escrow completions
        if (dest !== agentAddr) escrowFinish++;
      }
    }
    const escrowCompletionRate = escrowCreate > 0 ? Math.min(escrowFinish / escrowCreate, 1) : 0;

    // Account age from the FIRST (oldest) transaction — robust for > 200-tx accounts,
    // unlike taking the min date of the most-recent descending window.
    const first: any = await c.request({ command: 'account_tx', account: agentAddr, limit: 1, forward: true } as any);
    const firstRow = (first.result.transactions ?? [])[0];
    const genesisDate = firstRow ? (firstRow.tx?.date ?? firstRow.tx_json?.date) : undefined;
    const accountAgeDays = typeof genesisDate === 'number' ? Math.max(0, (nowRipple - genesisDate) / 86400) : 0;

    return { rlusdPayments: payments, escrowCompletionRate, accountAgeDays };
  } catch {
    return {};
  }
}
