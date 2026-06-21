import { describe, it, expect } from 'vitest';
import { buildBankGateSetup } from '../src/xrpl/bankGate.js';

describe('buildBankGateSetup', () => {
  it('returns AccountSet(asfDepositAuth) then DepositPreauth(AuthorizeCredentials)', () => {
    const creds = [{ Credential: { Issuer: 'rMesh', CredentialType: 'AABB' } }];
    const [accountSet, preauth] = buildBankGateSetup('rBank', creds);
    expect(accountSet).toMatchObject({ TransactionType: 'AccountSet', Account: 'rBank', SetFlag: 9 });
    expect(preauth).toMatchObject({ TransactionType: 'DepositPreauth', Account: 'rBank', AuthorizeCredentials: creds });
  });
});
