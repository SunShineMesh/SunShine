// XLS-70 AgentTrustCredential lifecycle: issue (issuer), accept (agent),
// fetch (anyone), revoke (issuer kill-switch). Tx shapes proven in the spike.
import { type Client, type Wallet } from 'xrpl';
import { CRED_TYPE, LSF_ACCEPTED, encodeTrustURI, decodeTrustURI, type TrustTerms } from './codec.js';
import { submit } from './client.js';

/** Issuer issues an AgentTrustCredential to the agent (subject). */
export async function issueCredential(c: Client, treasury: Wallet, agentAddr: string, terms: TrustTerms): Promise<string> {
  const r = await submit(c, treasury, {
    TransactionType: 'CredentialCreate',
    Account: treasury.address,
    Subject: agentAddr,
    CredentialType: CRED_TYPE,
    URI: encodeTrustURI(terms),
    Expiration: terms.exp,
  }, 'CredentialCreate');
  return r.hash;
}

/** Agent accepts the credential (sets lsfAccepted). Must be signed by the agent. */
export async function acceptCredential(c: Client, agent: Wallet, issuerAddr: string): Promise<string> {
  const r = await submit(c, agent, {
    TransactionType: 'CredentialAccept',
    Account: agent.address,
    Issuer: issuerAddr,
    CredentialType: CRED_TYPE,
  }, 'CredentialAccept');
  return r.hash;
}

export interface CredentialView { credId: string; accepted: boolean; terms: TrustTerms; }

/** Read the on-ledger credential (portable; any party can call this). null if absent. */
export async function fetchCredential(c: Client, agentAddr: string, issuerAddr: string): Promise<CredentialView | null> {
  try {
    const le: any = await c.request({
      command: 'ledger_entry',
      credential: { subject: agentAddr, issuer: issuerAddr, credential_type: CRED_TYPE },
      ledger_index: 'validated',
    } as any);
    const node = le.result.node;
    return {
      credId: le.result.index,
      accepted: (Number(node.Flags) & LSF_ACCEPTED) !== 0,
      terms: decodeTrustURI(node.URI),
    };
  } catch {
    return null; // entryNotFound
  }
}

/** Treasury revokes the credential — the instant kill-switch. */
export async function revokeCredential(c: Client, treasury: Wallet, agentAddr: string): Promise<string> {
  const r = await submit(c, treasury, {
    TransactionType: 'CredentialDelete',
    Account: treasury.address,
    Subject: agentAddr,
    CredentialType: CRED_TYPE,
  }, 'CredentialDelete');
  return r.hash;
}
