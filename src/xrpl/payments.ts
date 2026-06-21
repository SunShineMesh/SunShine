// Loan disbursement (treasury pays merchant on agent's behalf) and autonomous
// repayment (agent signs its OWN payment to treasury). Asset = XRP or our IOU
// per CONFIG. InvoiceID binds disbursement <-> repayment for off-chain matching.
import { type Client, type Wallet, xrpToDrops, convertStringToHex } from 'xrpl';
import { CONFIG } from '../config.js';
import { iouAmount } from './stablecoin.js';
import { submit } from './client.js';

function amount(value: string): any {
  return CONFIG.asset.kind === 'XRP'
    ? xrpToDrops(value)
    : iouAmount(value, CONFIG.asset.issuer, CONFIG.asset.currency);
}

function memo(obj: object) {
  return { Memo: { MemoData: convertStringToHex(JSON.stringify(obj)) } };
}

/** Treasury sponsors the agent's payment to a merchant (the credit draw). */
export async function sponsorPayment(c: Client, treasury: Wallet, dest: string, value: string, invoiceId: string, meta: object): Promise<string> {
  const r = await submit(c, treasury, {
    TransactionType: 'Payment',
    Account: treasury.address,
    Destination: dest,
    Amount: amount(value),
    InvoiceID: invoiceId,
    Memos: [memo({ kind: 'loan_disbursement', invoiceId, ...meta })],
  }, 'Sponsored Payment');
  return r.hash;
}

/** Agent autonomously repays treasury — no human dashboard click (the t54 delta). */
export async function agentRepay(c: Client, agent: Wallet, treasuryAddr: string, value: string, invoiceId: string, meta: object): Promise<string> {
  const r = await submit(c, agent, {
    TransactionType: 'Payment',
    Account: agent.address,
    Destination: treasuryAddr,
    Amount: amount(value),
    InvoiceID: invoiceId,
    Memos: [memo({ kind: 'repayment', invoiceId, ...meta })],
  }, 'Agent Repay');
  return r.hash;
}
