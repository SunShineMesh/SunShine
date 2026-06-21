// Cross-currency value transfer over the XRPL decentralized exchange.
// A Payment with SendMax (source currency) + Amount (destination currency) is
// auto-routed by the ledger through order books / AMM. For the demo,
// seedOfferBook() supplies liquidity for the chosen IOU pair on testnet.
//
// No atomic FX+escrow in one tx (the Batch amendment is not yet mainnet): the
// swap and the escrow are two sequential ledger transactions.
import { type Client, type Wallet } from 'xrpl';
import { submit } from './client.js';

export type Amount = string | { currency: string; issuer: string; value: string };

/** Payment flag: deliver up to Amount, debiting up to SendMax (slippage tolerance). */
export const TF_PARTIAL_PAYMENT = 0x00020000;

/** Pure cross-currency Payment tx builder. */
export function buildPathPayment(o: {
  senderAddr: string; destAddr: string; sendMax: Amount; deliverAmount: Amount; partial?: boolean;
}): Record<string, unknown> {
  const tx: Record<string, unknown> = {
    TransactionType: 'Payment',
    Account: o.senderAddr,
    Destination: o.destAddr,
    Amount: o.deliverAmount,
    SendMax: o.sendMax,
  };
  if (o.partial) tx.Flags = TF_PARTIAL_PAYMENT;
  return tx;
}

/** Convert sendMax (source ccy) → deliverAmount (dest ccy), routed by the DEX. */
export async function swapViaPathPayment(
  c: Client, sender: Wallet, destAddr: string, sendMax: Amount, deliverAmount: Amount,
  opts: { partial?: boolean } = {},
): Promise<string> {
  const r = await submit(c, sender, buildPathPayment({
    senderAddr: sender.address, destAddr, sendMax, deliverAmount, partial: opts.partial,
  }), 'DEX path payment');
  return r.hash;
}

/** Seed demo liquidity: `maker` places an OfferCreate giving `gives` for `gets`. */
export async function seedOfferBook(c: Client, maker: Wallet, gives: Amount, gets: Amount): Promise<string> {
  const r = await submit(c, maker, {
    TransactionType: 'OfferCreate', Account: maker.address, TakerGets: gives, TakerPays: gets,
  }, 'OfferCreate(seed)');
  return r.hash;
}
