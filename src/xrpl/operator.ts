// XLS-70 OperatorCredential lifecycle for MeshCredit's KYB / business-operator
// layer. Mirrors credential.ts conventions exactly: same submit() helper, same
// ledger_entry read pattern, same hex/URI encoding style.
//
// Credential type: "operator_v1"  →  OPERATOR_CRED_TYPE (uppercase hex)
// URI payload: compact JSON  { v, btier, maxDelegatedSpend, kybHash, juris, exp }
//
// Nesting: an agent's agent_trust_v1 TrustTerms object can carry an optional
// `op` field (operator address or credential ID) placed by embedOperatorRef()
// and read back by extractOperatorRef().  No existing codec.ts code is changed.

import { type Client, type Wallet } from 'xrpl';
import { toHex, fromHex, LSF_ACCEPTED, type TrustTerms } from './codec.js';
import { submit } from './client.js';

// ── Credential-type constant ─────────────────────────────────────────────────

/** CredentialType for MeshCredit operator KYB credentials (hex of "operator_v1"). */
export const OPERATOR_CRED_TYPE = toHex('operator_v1');
// Buffer.from('operator_v1').toString('hex').toUpperCase() = "6F70657261746F725F7631"

// ── OperatorTerms (URI payload) ──────────────────────────────────────────────

/**
 * Compact on-ledger operator credential payload.
 * Stored as JSON in the XLS-70 URI field (hex-encoded).
 * Must stay <= 256 bytes after JSON.stringify().
 */
export interface OperatorTerms {
  v: 1;
  /** Business tier from the KYB scorecard (e.g. "BTIER-2"). */
  btier: string;
  /** Max delegated spend ceiling string, IOU-safe (e.g. "10000"). */
  maxDelegatedSpend: string;
  /** Off-chain KYB dossier content-hash pointer (16–64 hex chars). */
  kybHash: string;
  /** ISO-2 / FATF jurisdiction code (e.g. "CH"). */
  juris: string;
  /** Expiry in Ripple-epoch seconds (same convention as TrustTerms.exp). */
  exp: number;
}

/** Encode operator terms to a hex URI; throws if payload > 256 bytes. */
export function encodeOperatorURI(t: OperatorTerms): string {
  const hex = Buffer.from(JSON.stringify(t), 'utf8').toString('hex').toUpperCase();
  // xrpl.js validates the URI hex STRING length (MAX_URI_LENGTH = 256 chars = 128 bytes of data).
  if (hex.length > 256) throw new Error(`operator URI ${hex.length} hex chars > 256 (XLS-70 URI cap)`);
  return hex;
}

export function decodeOperatorURI(hex: string): OperatorTerms {
  const { aggLimit, ...rest }: any = JSON.parse(Buffer.from(hex, 'hex').toString('utf8'));
  return { ...rest, maxDelegatedSpend: rest.maxDelegatedSpend ?? aggLimit ?? '0' } as OperatorTerms;
}

// ── On-ledger credential lifecycle ──────────────────────────────────────────
//
// NOTE: CredentialCreate / CredentialAccept / CredentialDelete are live XLS-70
// transactions on XRPL mainnet / testnet. The xrpl.js v5 typings include all
// three; we submit them via the same submit() helper as credential.ts.

/** Treasury (or a designated KYB issuer) issues an operator_v1 credential to the operator. */
export async function issueOperatorCredential(
  c: Client,
  issuer: Wallet,
  operatorAddr: string,
  terms: OperatorTerms,
): Promise<string> {
  const r = await submit(c, issuer, {
    TransactionType: 'CredentialCreate',
    Account: issuer.address,
    Subject: operatorAddr,
    CredentialType: OPERATOR_CRED_TYPE,
    URI: encodeOperatorURI(terms),
    Expiration: terms.exp,
  }, 'OperatorCredentialCreate');
  return r.hash;
}

/** Operator accepts the credential (sets lsfAccepted on-ledger). Must be signed by the operator. */
export async function acceptOperatorCredential(
  c: Client,
  operator: Wallet,
  issuerAddr: string,
): Promise<string> {
  const r = await submit(c, operator, {
    TransactionType: 'CredentialAccept',
    Account: operator.address,
    Issuer: issuerAddr,
    CredentialType: OPERATOR_CRED_TYPE,
  }, 'OperatorCredentialAccept');
  return r.hash;
}

/** Kill-switch: issuer deletes the operator credential (revokes KYB + aggregate cap). */
export async function deleteOperatorCredential(
  c: Client,
  issuer: Wallet,
  operatorAddr: string,
): Promise<string> {
  const r = await submit(c, issuer, {
    TransactionType: 'CredentialDelete',
    Account: issuer.address,
    Subject: operatorAddr,
    CredentialType: OPERATOR_CRED_TYPE,
  }, 'OperatorCredentialDelete');
  return r.hash;
}

// ── Ledger read ──────────────────────────────────────────────────────────────

export interface OperatorCredentialView {
  credId: string;
  accepted: boolean;
  terms: OperatorTerms;
}

/**
 * Read the on-ledger operator credential via ledger_entry (any party can call).
 * Returns null if the credential does not exist.
 */
export async function fetchOperatorCredential(
  c: Client,
  operatorAddr: string,
  issuerAddr: string,
): Promise<OperatorCredentialView | null> {
  try {
    const le: any = await c.request({
      command: 'ledger_entry',
      credential: {
        subject: operatorAddr,
        issuer: issuerAddr,
        credential_type: OPERATOR_CRED_TYPE,
      },
      ledger_index: 'validated',
    } as any);
    const node = le.result.node;
    return {
      credId: le.result.index,
      accepted: (Number(node.Flags) & LSF_ACCEPTED) !== 0,
      terms: decodeOperatorURI(node.URI),
    };
  } catch {
    return null; // entryNotFound
  }
}

// ── Agent→Operator nesting reference ────────────────────────────────────────
//
// An agent's TrustTerms (from codec.ts) can carry an optional `op` field that
// references the operator this agent is nested under.  We extend TrustTerms
// non-destructively: the base type stays as-is; the extended type adds `op`.
// embedOperatorRef() returns a NEW object — it never mutates the input.

/** Extended TrustTerms that carries an optional operator reference. */
export interface ExtendedTrustTerms extends TrustTerms {
  /** Operator address (r…) or operator credential ledger-entry ID (64 uppercase hex). */
  op?: string;
}

/**
 * Return a new TrustTerms object with the operator reference embedded.
 * Does NOT mutate the original terms.
 *
 * Pass to encodeTrustURI() from codec.ts as-is — the extra `op` field is
 * silently carried in the JSON payload (it stays within the 256-byte cap for
 * realistic values; callers should validate with encodeTrustURI if uncertain).
 */
export function embedOperatorRef(
  terms: TrustTerms,
  opts: { op: string },
): ExtendedTrustTerms {
  return { ...terms, op: opts.op };
}

/**
 * Read the operator reference from a (possibly extended) TrustTerms object.
 * Returns undefined if no `op` field is present (backwards-compatible with
 * plain TrustTerms that pre-date the operator layer).
 */
export function extractOperatorRef(terms: TrustTerms | ExtendedTrustTerms): string | undefined {
  return (terms as ExtendedTrustTerms).op;
}
