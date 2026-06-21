// XLS-70 agent_skill_v1 credential — the second pillar (UC2). Same lifecycle as
// the trust credential, different CredentialType + payload. One agent wallet can
// hold BOTH a trust cert and a skill cert, each readable on-ledger by anyone —
// the visible proof that the bureau model extends beyond payments.
import { type Client, type Wallet } from 'xrpl';
import { toHex, fromHex, LSF_ACCEPTED } from './codec.js';
import { submit } from './client.js';
import { sha256Hex } from '../agent/attest.js';

/** Real content hash of a skill's bytes → SkillTerms.benchmarkHash (16 hex; feeds L3). */
export const skillContentHash = (skillBytes: Buffer | string): string => sha256Hex(skillBytes).slice(0, 16);

/** CredentialType for MeshCredit agent skill credentials (hex of "agent_skill_v1"). */
export const SKILL_CRED_TYPE = toHex('agent_skill_v1');

export interface SkillTerms {
  v: 1;
  skillId: string;       // e.g. "pdf-extract"
  skillVersion: string;  // e.g. "1.2.0"
  benchmarkHash: string; // off-chain benchmark/evaluation content-hash pointer
  exp: number;           // Ripple-epoch seconds
}

export function encodeSkillURI(t: SkillTerms): string {
  const hex = toHex(JSON.stringify(t));
  if (hex.length > 256) throw new Error(`skill URI ${hex.length} hex chars > 256 (XLS-70 URI cap)`);
  return hex;
}

export const decodeSkillURI = (hex: string): SkillTerms => JSON.parse(fromHex(hex)) as SkillTerms;

export async function issueSkillCredential(c: Client, issuer: Wallet, agentAddr: string, t: SkillTerms): Promise<string> {
  const r = await submit(c, issuer, {
    TransactionType: 'CredentialCreate', Account: issuer.address, Subject: agentAddr,
    CredentialType: SKILL_CRED_TYPE, URI: encodeSkillURI(t), Expiration: t.exp,
  }, 'SkillCredentialCreate');
  return r.hash;
}

export async function acceptSkillCredential(c: Client, agent: Wallet, issuerAddr: string): Promise<string> {
  const r = await submit(c, agent, {
    TransactionType: 'CredentialAccept', Account: agent.address, Issuer: issuerAddr, CredentialType: SKILL_CRED_TYPE,
  }, 'SkillCredentialAccept');
  return r.hash;
}

export interface SkillCredentialView { credId: string; accepted: boolean; terms: SkillTerms; }

export async function fetchSkillCredential(c: Client, agentAddr: string, issuerAddr: string): Promise<SkillCredentialView | null> {
  try {
    const le: any = await c.request({
      command: 'ledger_entry',
      credential: { subject: agentAddr, issuer: issuerAddr, credential_type: SKILL_CRED_TYPE },
      ledger_index: 'validated',
    } as any);
    const node = le.result.node;
    return { credId: le.result.index, accepted: (Number(node.Flags) & LSF_ACCEPTED) !== 0, terms: decodeSkillURI(node.URI) };
  } catch {
    return null;
  }
}

export async function revokeSkillCredential(c: Client, issuer: Wallet, agentAddr: string): Promise<string> {
  const r = await submit(c, issuer, {
    TransactionType: 'CredentialDelete', Account: issuer.address, Subject: agentAddr, CredentialType: SKILL_CRED_TYPE,
  }, 'SkillCredentialDelete');
  return r.hash;
}
