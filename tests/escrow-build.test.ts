import { describe, it, expect } from 'vitest';
import { buildEscrowFinish } from '../src/xrpl/escrow.js';

describe('buildEscrowFinish', () => {
  const base = { finisherAddr: 'rFin', ownerAddr: 'rOwn', offerSequence: 42, condition: 'C0', fulfillment: 'F0' };

  it('includes CredentialIDs when provided (the DepositAuth gate requirement)', () => {
    const tx = buildEscrowFinish({ ...base, credentialIDs: ['ABC123'] });
    expect(tx).toMatchObject({
      TransactionType: 'EscrowFinish', Account: 'rFin', Owner: 'rOwn',
      OfferSequence: 42, Condition: 'C0', Fulfillment: 'F0', CredentialIDs: ['ABC123'],
    });
  });

  it('omits CredentialIDs entirely when not provided', () => {
    expect('CredentialIDs' in buildEscrowFinish(base)).toBe(false);
  });

  it('omits CredentialIDs when given an empty array', () => {
    expect('CredentialIDs' in buildEscrowFinish({ ...base, credentialIDs: [] })).toBe(false);
  });
});
