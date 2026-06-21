import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentStore, type PaymentRequest } from '../src/treasury/paymentStore.js';

const sample = (id = 'pay-1'): PaymentRequest => ({
  id,
  agentAddr: 'rAg',
  senderAddr: 'rAlice',
  recipientAddr: 'rBob',
  amount: '100',
  currency: 'RLUSD',
  escrowSequence: 7,
  condition: 'C0',
  fulfillment: 'F0',
  status: 'pending_bank',
  travelRulePayload: '{"originator":"Alice"}',
  createdAt: 1,
  escrowHash: 'h1',
});

describe('PaymentStore', () => {
  let seq = 0;
  const path = () => join(tmpdir(), `mc-pay-${process.pid}-${seq++}.json`);

  it('creates and reads back by agent', () => {
    const store = new PaymentStore(path());
    store.create(sample());
    expect(store.byAgent('rAg')).toHaveLength(1);
    expect(store.get('pay-1')?.recipientAddr).toBe('rBob');
  });

  it('transitions status pending_bank → released', () => {
    const store = new PaymentStore(path());
    store.create(sample());
    const updated = store.update('pay-1', { status: 'released', finishHash: 'h2' });
    expect(updated.status).toBe('released');
    expect(store.get('pay-1')?.finishHash).toBe('h2');
  });

  it('throws updating an unknown id', () => {
    const store = new PaymentStore(path());
    expect(() => store.update('nope', { status: 'rejected' })).toThrow(/not found/);
  });

  it('all() returns every request', () => {
    const store = new PaymentStore(path());
    store.create(sample('pay-1'));
    store.create(sample('pay-2'));
    expect(store.all()).toHaveLength(2);
  });
});
