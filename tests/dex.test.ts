import { describe, it, expect } from 'vitest';
import { buildPathPayment, TF_PARTIAL_PAYMENT } from '../src/xrpl/dex.js';

describe('buildPathPayment', () => {
  const sendMax = { currency: 'USD', issuer: 'rIssA', value: '101' };
  const deliver = { currency: 'EUR', issuer: 'rIssB', value: '100' };

  it('sets SendMax (source ccy) + Amount (dest ccy) for a cross-currency payment', () => {
    const tx = buildPathPayment({ senderAddr: 'rAl', destAddr: 'rAl', sendMax, deliverAmount: deliver });
    expect(tx).toMatchObject({ TransactionType: 'Payment', Account: 'rAl', Destination: 'rAl', Amount: deliver, SendMax: sendMax });
  });

  it('omits Flags by default', () => {
    expect('Flags' in buildPathPayment({ senderAddr: 'rAl', destAddr: 'rAl', sendMax, deliverAmount: deliver })).toBe(false);
  });

  it('sets the partial-payment flag when requested', () => {
    const tx = buildPathPayment({ senderAddr: 'rAl', destAddr: 'rAl', sendMax, deliverAmount: deliver, partial: true });
    expect(tx.Flags).toBe(TF_PARTIAL_PAYMENT);
    expect(TF_PARTIAL_PAYMENT).toBe(0x00020000);
  });
});
