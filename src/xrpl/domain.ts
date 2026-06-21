// XLS-80 Permissioned Domain access-control layer for MeshCredit.
//
// Provides:
//   createPermissionedDomain — create an on-ledger PermissionedDomain entry
//     gated on the treasury-issued agent_trust_v1 credential.
//   setupDepositPreauth — enable DepositAuth on an account and grant access
//     only to holders of the agent_trust_v1 credential (AuthorizeCredentials).
//   gateCheck — pure-ish read: fetch the on-ledger credential, decode its tier,
//     and return { allowed, tier, reason }.
//   tierRank / compareTier — pure helpers exported for unit testing.
//   buildAcceptedCredentials — build the AcceptedCredentials array consumed by
//     both PermissionedDomainSet and DepositPreauth.
//
// Kill-switch note: revokeCredential() (CredentialDelete) in credential.ts is
// the single kill-switch. Because the PermissionedDomain's AcceptedCredentials
// list requires the credential to exist AND have lsfAccepted set, deleting the
// credential atomically removes the agent from every domain that references it
// — no separate domain update is needed.
//
// NOTE: PermissionedDomainSet IS present in xrpl.js v5 typings (confirmed in
// node_modules). DepositPreauth with AuthorizeCredentials is also typed. No raw
// plain-object fallbacks are needed — we use the typed imports directly.

import { type Client, type Wallet, type AuthorizeCredential, AccountSetAsfFlags } from 'xrpl';
import { CRED_TYPE, LSF_ACCEPTED, decodeTrustURI } from './codec.js';
import { submit } from './client.js';
import type { Tier } from '../kya/scorecard.js';

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Numeric rank of a credit tier (higher = better).
 *  Handles both v1/v2 Tier strings (DENIED, TIER-1…TIER-4) and v3 PassportTier
 *  strings (DENIED, BRONZE, SILVER, GOLD, PLATINUM) so gateCheck works with
 *  credentials issued by either underwriting version. */
export function tierRank(tier: string): number {
  switch (tier) {
    // v1/v2 legacy tiers
    case 'DENIED':   return 0;
    case 'TIER-1':   return 1;
    case 'TIER-2':   return 2;
    case 'TIER-3':   return 3;
    case 'TIER-4':   return 4;
    // v3 passport tiers — mapped to the equivalent rank bracket
    case 'BRONZE':   return 1;
    case 'SILVER':   return 2;
    case 'GOLD':     return 3;
    case 'PLATINUM': return 4;
    default:         return 0; // unknown → no access
  }
}

/**
 * Pure tier comparison: true iff agentTier satisfies requiredTier.
 * (agent rank >= required rank)
 */
export function compareTier(agentTier: Tier | string, requiredTier: Tier | string): boolean {
  return tierRank(agentTier) >= tierRank(requiredTier);
}

/** True iff a payment of `amount` is within the credential's stated ceiling. */
export function withinLimit(maxTxAmount: string, amount: string): boolean {
  return Number(amount) <= Number(maxTxAmount);
}

/**
 * Build the AcceptedCredentials array for PermissionedDomainSet.
 * Shape: AuthorizeCredential[] per xrpl.js v5 common types.
 * Each element is: { Credential: { Issuer: string; CredentialType: string } }
 */
export function buildAcceptedCredentials(issuerAddr: string): AuthorizeCredential[] {
  return [
    {
      Credential: {
        Issuer: issuerAddr,
        CredentialType: CRED_TYPE, // hex of "agent_trust_v1"
      },
    },
  ];
}

// ── On-chain functions ───────────────────────────────────────────────────────

export interface DomainResult {
  domainId: string; // LedgerIndex of the created PermissionedDomain entry
  hash: string;     // transaction hash
}

/**
 * Create (or update) a PermissionedDomain entry owned by `owner`, accepting
 * the treasury's agent_trust_v1 credential.
 *
 * If DomainID is omitted the ledger creates a new domain; include it to update.
 * Returns the DomainID parsed from the CreatedNode in transaction metadata.
 *
 * Tx shape: PermissionedDomainSet (fully typed in xrpl.js v5).
 */
export async function createPermissionedDomain(
  c: Client,
  owner: Wallet,
  acceptedCredentials: AuthorizeCredential[],
): Promise<DomainResult> {
  const r = await submit(c, owner, {
    TransactionType: 'PermissionedDomainSet',
    Account: owner.address,
    AcceptedCredentials: acceptedCredentials,
  }, 'PermissionedDomainSet');

  // Parse the DomainID from the metadata CreatedNode for PermissionedDomain.
  const meta: any = r.result.meta;
  const createdNode = (meta?.AffectedNodes ?? []).find(
    (n: any) =>
      n.CreatedNode?.LedgerEntryType === 'PermissionedDomain',
  );
  const domainId: string = createdNode?.CreatedNode?.LedgerIndex ?? '';
  if (!domainId) {
    throw new Error('PermissionedDomainSet succeeded but no CreatedNode.LedgerIndex found in metadata');
  }

  return { domainId, hash: r.hash };
}

export interface DepositPreauthResult {
  accountSetHash: string; // AccountSet tx that enabled asfDepositAuth
  preauthHash: string;    // DepositPreauth tx that granted access to credentialed agents
}

/**
 * Enable deposit authorization on `account` and grant access to agents holding
 * the treasury's agent_trust_v1 credential.
 *
 * Step 1: AccountSet with SetFlag = asfDepositAuth (flag 9) — blocks all
 *   incoming payments to this account unless pre-authorized.
 * Step 2: DepositPreauth with AuthorizeCredentials — any holder of a valid
 *   agent_trust_v1 credential from `credentialIssuer` can now pay/repay.
 *
 * The `authorizeCredentials` param is the same AuthorizeCredential[] returned
 * by buildAcceptedCredentials(). Pass it explicitly so the caller controls which
 * credential set is authorized (matches the domain's AcceptedCredentials).
 */
export async function setupDepositPreauth(
  c: Client,
  account: Wallet,
  authorizeCredentials: AuthorizeCredential[],
): Promise<DepositPreauthResult> {
  // Step 1: enable DepositAuth flag on the account
  const accountSetResult = await submit(c, account, {
    TransactionType: 'AccountSet',
    Account: account.address,
    SetFlag: AccountSetAsfFlags.asfDepositAuth, // 9
  }, 'AccountSet(asfDepositAuth)');

  // Step 2: pre-authorize any holder of the given credential
  const preauthResult = await submit(c, account, {
    TransactionType: 'DepositPreauth',
    Account: account.address,
    AuthorizeCredentials: authorizeCredentials,
  }, 'DepositPreauth(AuthorizeCredentials)');

  return {
    accountSetHash: accountSetResult.hash,
    preauthHash: preauthResult.hash,
  };
}

// ── GateCheck ────────────────────────────────────────────────────────────────

export interface GateCheckResult {
  allowed: boolean;
  tier: Tier | null;  // null if no credential found
  reason: string;
}

/**
 * Read the agent's on-ledger agent_trust_v1 credential (via ledger_entry),
 * decode its tier, and return { allowed, tier, reason }.
 *
 * allowed = true iff:
 *   1. The credential exists on-ledger.
 *   2. lsfAccepted flag is set (agent accepted it).
 *   3. agentTier >= requiredTier.
 *
 * This is "pure-ish": it reads on-chain state but has no side effects.
 * The issuer address of the credential to check is provided via `issuerAddr`.
 */
export async function gateCheck(
  c: Client,
  agentAddr: string,
  issuerAddr: string,
  requiredTier: Tier,
  opts: { amount?: string } = {},
): Promise<GateCheckResult> {
  let node: any;
  try {
    const le: any = await c.request({
      command: 'ledger_entry',
      credential: {
        subject: agentAddr,
        issuer: issuerAddr,
        credential_type: CRED_TYPE,
      },
      ledger_index: 'validated',
    } as any);
    node = le.result.node;
  } catch {
    return { allowed: false, tier: null, reason: 'credential not found on ledger' };
  }

  const accepted = (Number(node.Flags) & LSF_ACCEPTED) !== 0;
  if (!accepted) {
    return { allowed: false, tier: null, reason: 'credential exists but lsfAccepted is not set' };
  }

  let terms;
  try {
    terms = decodeTrustURI(node.URI as string);
  } catch {
    return { allowed: false, tier: null, reason: 'credential URI could not be decoded' };
  }

  const agentTier = terms.tier as Tier;
  const meetsRequirement = compareTier(agentTier, requiredTier);

  if (!meetsRequirement) {
    return {
      allowed: false,
      tier: agentTier,
      reason: `agent tier ${agentTier} (rank ${tierRank(agentTier)}) is below required tier ${requiredTier} (rank ${tierRank(requiredTier)})`,
    };
  }

  if (opts.amount !== undefined && !withinLimit(terms.maxTxAmount, opts.amount)) {
    return {
      allowed: false,
      tier: agentTier,
      reason: `amount ${opts.amount} exceeds credential maxTxAmount ${terms.maxTxAmount}`,
    };
  }

  return { allowed: true, tier: agentTier, reason: 'ok' };
}
