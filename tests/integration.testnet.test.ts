// Live XRPL testnet integration test — the full MeshCredit lifecycle through the
// typed module layer. Excluded from the default `npm test`; run via `npm run test:testnet`.
import { describe, it, expect, afterAll } from 'vitest';
import { getClient, closeClient } from '../src/xrpl/client.js';
import { fundNew } from '../src/xrpl/wallets.js';
import { issueCredential, acceptCredential, fetchCredential, revokeCredential } from '../src/xrpl/credential.js';
import { sponsorPayment, agentRepay } from '../src/xrpl/payments.js';
import { invoiceId, toRippleEpoch, dossierRef } from '../src/xrpl/codec.js';

describe('MeshCredit lifecycle on testnet', () => {
  afterAll(async () => { await closeClient(); });

  it('issue → accept → disburse → autonomous repay → kill-switch', async () => {
    const c = await getClient();
    const treasury = await fundNew(c, 'treasury');
    const agent = await fundNew(c, 'agent');
    const vendor = await fundNew(c, 'vendor');

    const exp = toRippleEpoch(Date.now()) + 30 * 24 * 3600;
    const terms = { v: 1 as const, tier: 'TIER-2', maxTxAmount: '100', score: 65, exp, ref: dossierRef('kya:itest') };

    await issueCredential(c, treasury, agent.address, terms);
    await acceptCredential(c, agent, treasury.address);

    const view = await fetchCredential(c, agent.address, treasury.address);
    expect(view?.accepted).toBe(true);
    expect(view?.terms.tier).toBe('TIER-2');

    const inv = invoiceId('itest-' + agent.address);
    const disburse = await sponsorPayment(c, treasury, vendor.address, '5', inv, { credId: view!.credId });
    expect(disburse).toMatch(/^[0-9A-F]{64}$/);

    const repay = await agentRepay(c, agent, treasury.address, '5.05', inv, { principal: '5', interest: '0.05' });
    expect(repay).toMatch(/^[0-9A-F]{64}$/);

    await revokeCredential(c, treasury, agent.address);
    const after = await fetchCredential(c, agent.address, treasury.address);
    expect(after).toBeNull();
  }, 180000);
});
