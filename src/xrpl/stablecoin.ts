// Self-issued test stablecoin (RLUSD stand-in) on an issuer we control. Setting
// asfAllowTrustLineLocking (17) ALSO unlocks the XLS-85 escrow stretch on testnet,
// demonstrating the single-flag mainnet path (mainnet RLUSD issuer has it FALSE).
import { type Client, type Wallet } from 'xrpl';
import { submit } from './client.js';

const ASF_DEFAULT_RIPPLE = 8;
const ASF_ALLOW_TRUSTLINE_LOCKING = 17;

export function iouAmount(amount: string, issuer: string, currency = 'USD') {
  return { currency, issuer, value: amount };
}

/** Configure the issuer: DefaultRipple + AllowTrustLineLocking. */
export async function setupStablecoin(c: Client, issuer: Wallet): Promise<void> {
  await submit(c, issuer, { TransactionType: 'AccountSet', Account: issuer.address, SetFlag: ASF_DEFAULT_RIPPLE }, 'AccountSet DefaultRipple');
  await submit(c, issuer, { TransactionType: 'AccountSet', Account: issuer.address, SetFlag: ASF_ALLOW_TRUSTLINE_LOCKING }, 'AccountSet AllowTrustLineLocking');
}

/** Holder opens a trust line to the issuer (so it can hold/receive the IOU). */
export async function establishTrustline(c: Client, issuer: Wallet, holder: Wallet, currency = 'USD'): Promise<void> {
  await submit(c, holder, {
    TransactionType: 'TrustSet',
    Account: holder.address,
    LimitAmount: iouAmount('1000000', issuer.address, currency),
  }, 'TrustSet');
}

/** Holder trusts the issuer, then issuer funds the holder with `amount` of the IOU. */
export async function trustAndFund(c: Client, issuer: Wallet, holder: Wallet, amount: string, currency = 'USD'): Promise<void> {
  await establishTrustline(c, issuer, holder, currency);
  await submit(c, issuer, {
    TransactionType: 'Payment',
    Account: issuer.address,
    Destination: holder.address,
    Amount: iouAmount(amount, issuer.address, currency),
  }, 'Fund IOU');
}
