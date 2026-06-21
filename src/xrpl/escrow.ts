// XLS-85 token escrow — the "one-flag-from-mainnet" stretch.
//
// The agent locks an IOU repayment in an escrow gated by a PREIMAGE-SHA-256
// crypto-condition, then releases it autonomously by revealing the secret. This
// requires the IOU issuer to have asfAllowTrustLineLocking set — mainnet RLUSD's
// issuer does NOT (verified), so this runs on testnet against an issuer we
// control. The day Ripple sets that one flag, the same code escrows real RLUSD.
import { type Client, type Wallet } from 'xrpl';
import { makePreimageCondition, toRippleEpoch } from './codec.js';
import { submit } from './client.js';

/** XRP drops (string) or an issued-currency amount object. */
export type EscrowAmount = string | { currency: string; issuer: string; value: string };

export interface EscrowHandle {
  createHash: string;
  sequence: number;    // the EscrowCreate Sequence — needed as OfferSequence to finish
  condition: string;   // on-ledger crypto-condition
  fulfillment: string; // the secret-revealing fulfillment (kept off-ledger until release)
  preimage: string;    // the raw secret
  cancelAfter: number; // ripple-epoch seconds — auto-refund deadline
}

/**
 * `from` locks `amount` in an escrow payable to `destAddr`, gated by a fresh
 * crypto-condition. CancelAfter is mandatory (the funds auto-refund if never
 * released). No FinishAfter is set, so the escrow can be released the instant the
 * secret is revealed.
 */
export async function createPaymentEscrow(
  c: Client,
  from: Wallet,
  destAddr: string,
  amount: EscrowAmount,
  opts: { cancelAfterSec?: number } = {},
): Promise<EscrowHandle> {
  const { condition, fulfillment, preimage } = makePreimageCondition();
  const cancelAfter = toRippleEpoch(Date.now() + (opts.cancelAfterSec ?? 3600) * 1000);

  // Autofill inline (not via submit()) so we can read the assigned Sequence —
  // it becomes the OfferSequence the finish must reference.
  const prepared: any = await c.autofill({
    TransactionType: 'EscrowCreate',
    Account: from.address,
    Destination: destAddr,
    Amount: amount as any,
    Condition: condition,
    CancelAfter: cancelAfter,
  });
  const sequence = prepared.Sequence as number;
  const signed = from.sign(prepared);
  const res = await c.submitAndWait(signed.tx_blob);
  const code = (res.result.meta as any)?.TransactionResult;
  if (code !== 'tesSUCCESS') throw new Error(`EscrowCreate failed: ${code}`);

  return { createHash: res.result.hash as string, sequence, condition, fulfillment, preimage, cancelAfter };
}

/**
 * Pure EscrowFinish tx builder. `credentialIDs` (the credential's ledger-entry
 * index — NOT the CredentialType hex) satisfies a DepositAuth gate on the
 * destination account; without it, an EscrowFinish into a gated account returns
 * tecNO_PERMISSION (testnet-confirmed in spike-depositauth-escrow.ts).
 */
export function buildEscrowFinish(o: {
  finisherAddr: string; ownerAddr: string; offerSequence: number;
  condition: string; fulfillment: string; credentialIDs?: string[];
}): Record<string, unknown> {
  const tx: Record<string, unknown> = {
    TransactionType: 'EscrowFinish',
    Account: o.finisherAddr,
    Owner: o.ownerAddr,
    OfferSequence: o.offerSequence,
    Condition: o.condition,
    Fulfillment: o.fulfillment,
  };
  if (o.credentialIDs && o.credentialIDs.length) tx.CredentialIDs = o.credentialIDs;
  return tx;
}

/**
 * Release the escrow by revealing the secret. Anyone holding the fulfillment can
 * sign this; in MeshCredit the agent finishes its own escrow into the bank's
 * gated account, presenting its trust credential via `opts.credentialIDs`.
 * autofill() computes the higher Fulfillment-based EscrowFinish fee.
 */
export async function finishEscrow(
  c: Client, finisher: Wallet, ownerAddr: string, h: EscrowHandle,
  opts: { credentialIDs?: string[] } = {},
): Promise<string> {
  const r = await submit(c, finisher, buildEscrowFinish({
    finisherAddr: finisher.address, ownerAddr, offerSequence: h.sequence,
    condition: h.condition, fulfillment: h.fulfillment, credentialIDs: opts.credentialIDs,
  }), 'EscrowFinish');
  return r.hash;
}
