// The bank-gate flow (Use Case 1). An agent locks a payment in escrow to the
// bank's DepositAuth-gated settlement account; release requires a valid
// MeshCredit credential (CredentialIDs on EscrowFinish — testnet-confirmed in
// spike-depositauth-escrow.ts). The BANK owns the gate; MeshCredit only issues
// the credential. Rejection cancels the escrow → funds refund to the sender, so
// the bureau can block delivery but never seizes or redirects client funds.
import { type Client, type Wallet, type AuthorizeCredential } from 'xrpl';
import { submit } from './client.js';
import { createPaymentEscrow, finishEscrow, type EscrowHandle, type EscrowAmount } from './escrow.js';

/** Pure: the two txs a bank submits to stand up its own gate for MeshCredit-certified agents. */
export function buildBankGateSetup(
  bankAddr: string,
  authorizeCredentials: AuthorizeCredential[],
): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { TransactionType: 'AccountSet', Account: bankAddr, SetFlag: 9 /* asfDepositAuth */ },
    { TransactionType: 'DepositPreauth', Account: bankAddr, AuthorizeCredentials: authorizeCredentials },
  ];
}

export type PaymentEscrowHandle = EscrowHandle & { docsMemoHash: string };

/** Agent locks `amount` in escrow to the bank's gated account; carries a docs-hash reference. */
export async function submitPaymentForApproval(
  c: Client, agent: Wallet, bankAddr: string, amount: EscrowAmount, docsMemoHash: string,
): Promise<PaymentEscrowHandle> {
  const handle = await createPaymentEscrow(c, agent, bankAddr, amount, {});
  return { ...handle, docsMemoHash };
}

/** Release into the gated account — succeeds only when a valid credential is presented. */
export async function approveAndRelease(
  c: Client, finisher: Wallet, ownerAddr: string, handle: EscrowHandle, credentialIDs: string[],
): Promise<string> {
  return finishEscrow(c, finisher, ownerAddr, handle, { credentialIDs });
}

/** Reject: cancel the escrow → funds refund to the sender (bureau never seizes). */
export async function rejectAndRefund(
  c: Client, canceller: Wallet, ownerAddr: string, handle: EscrowHandle,
): Promise<string> {
  const r = await submit(c, canceller, {
    TransactionType: 'EscrowCancel', Account: canceller.address, Owner: ownerAddr, OfferSequence: handle.sequence,
  }, 'EscrowCancel');
  return r.hash;
}
