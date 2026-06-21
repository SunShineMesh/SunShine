// Pure encoding helpers for XRPL / MeshCredit credentials. No network I/O.
import { createHash, randomBytes } from 'node:crypto';
import { type Tier, tierFromScore } from '../kya/scorecard.js';

/** XLS-70 Credential flag: lsfAccepted (set after CredentialAccept). */
export const LSF_ACCEPTED = 0x10000;

export const toHex = (s: string): string => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
export const fromHex = (h: string): string => Buffer.from(h, 'hex').toString('utf8');

/** CredentialType for MeshCredit agent trust credentials (hex of "agent_trust_v1"). */
export const CRED_TYPE = toHex('agent_trust_v1');

/** Convert a Unix-ms timestamp to seconds since the Ripple epoch (2000-01-01). */
export const toRippleEpoch = (unixMs: number): number => Math.floor(unixMs / 1000) - 946684800;

/** Deterministic 256-bit InvoiceID (64 uppercase hex chars) from any seed string. */
export const invoiceId = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex').toUpperCase();

/** Short off-chain dossier pointer (16 hex chars) derived from KYA inputs. */
export const dossierRef = (seed: string): string => invoiceId(seed).slice(0, 16);

export type Disposition = 'A' | 'R' | 'D';

/**
 * Compact trust summary stored on-ledger in the credential URI.
 * v1 = legacy verbose; v2 = abbreviated {v,d,s,m,e,r,ih,sh,op} so code-attestation
 * (ih/sh) + operator link (op8) fit the 256-hex XLS-70 cap (spike-measured 234/256).
 * `tier` is stored on v1 and DERIVED from `score` on v2 (saves bytes).
 */
export type TrustTerms = {
  v: 1 | 2;
  tier: string;
  maxTxAmount: string;
  score: number;
  exp: number;          // Ripple-epoch seconds
  ref: string;          // off-chain dossier content-hash pointer
  disposition?: Disposition; // v2: A=approve R=review D=deny
  ih?: string;          // v2: harness hash prefix (8 hex)
  sh?: string;          // v2: skill hash prefix (8 hex)
  op?: string;          // v2: operator credential id prefix (8 hex)
};

/** Encode trust terms to a hex URI; throws if it would exceed the 256-hex XLS-70 cap. */
export function encodeTrustURI(t: TrustTerms): string {
  const payload = t.v === 2
    ? {
        v: 2,
        d: t.disposition ?? (t.tier === 'DENIED' ? 'D' : 'A'),
        s: t.score,
        m: t.maxTxAmount,
        e: t.exp,
        r: t.ref,
        ...(t.ih ? { ih: t.ih } : {}),
        ...(t.sh ? { sh: t.sh } : {}),
        ...(t.op ? { op: t.op } : {}),
      }
    : { v: 1, tier: t.tier, maxTxAmount: t.maxTxAmount, score: t.score, exp: t.exp, ref: t.ref };
  const hex = toHex(JSON.stringify(payload));
  if (hex.length > 256) throw new Error(`trust URI ${hex.length} hex chars > 256 (XLS-70 URI cap)`);
  return hex;
}

/** Decode a v1 (verbose) or v2 (abbreviated) URI into a normalized TrustTerms. */
export function decodeTrustURI(hex: string): TrustTerms {
  const o = JSON.parse(fromHex(hex)) as any;
  if (o.v === 2) {
    const tier: Tier = tierFromScore(o.s);
    return {
      v: 2, tier, maxTxAmount: o.m, score: o.s, exp: o.e, ref: o.r, ...(o.d ? { disposition: o.d } : {}),
      ...(o.ih ? { ih: o.ih } : {}),
      ...(o.sh ? { sh: o.sh } : {}),
      ...(o.op ? { op: o.op } : {}),
    };
  }
  return { v: 1, tier: o.tier, maxTxAmount: o.maxTxAmount, score: o.score, exp: o.exp, ref: o.ref };
}

/**
 * A PREIMAGE-SHA-256 crypto-condition for XLS-85 escrow: the holder of `preimage`
 * (the secret) can release the escrow by presenting `fulfillment`; `condition`
 * goes on-ledger at EscrowCreate. Hand-rolled DER so we carry no crypto-conditions
 * dependency — the bytes match the five-bells / RFC draft encoding exactly.
 */
export interface PreimageCondition {
  condition: string;   // uppercase hex — EscrowCreate.Condition
  fulfillment: string; // uppercase hex — EscrowFinish.Fulfillment (reveals the secret)
  preimage: string;    // uppercase hex — the secret itself
}

/** Minimal DER unsigned-integer body (used for the condition's `cost` field). */
function derUint(n: number): Buffer {
  const bytes: number[] = [];
  let v = n;
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  if (bytes[0] & 0x80) bytes.unshift(0x00); // keep it positive
  return Buffer.from(bytes);
}

export function makePreimageCondition(preimage: Buffer = randomBytes(32)): PreimageCondition {
  if (preimage.length > 127) throw new Error('preimage must be <= 127 bytes (single-byte DER length)');
  const fingerprint = createHash('sha256').update(preimage).digest(); // 32 bytes

  // Fulfillment ::= [0] SEQUENCE { preimage [0] OCTET STRING }
  const ffBody = Buffer.concat([Buffer.from([0x80, preimage.length]), preimage]);
  const fulfillment = Buffer.concat([Buffer.from([0xa0, ffBody.length]), ffBody]);

  // Condition ::= [0] SEQUENCE { fingerprint [0] OCTET STRING(32), cost [1] INTEGER }
  const cost = derUint(preimage.length);
  const condBody = Buffer.concat([
    Buffer.from([0x80, 0x20]), fingerprint,
    Buffer.from([0x81, cost.length]), cost,
  ]);
  const condition = Buffer.concat([Buffer.from([0xa0, condBody.length]), condBody]);

  return {
    condition: condition.toString('hex').toUpperCase(),
    fulfillment: fulfillment.toString('hex').toUpperCase(),
    preimage: preimage.toString('hex').toUpperCase(),
  };
}
