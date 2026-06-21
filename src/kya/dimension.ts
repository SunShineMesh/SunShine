// D5 Capability mandate + six-dimension DimensionRecord.
//
// DimensionRecord is the unit of content inside the passport bundle — one per D1–D6.
// Each record carries a named issuer and an evidence hash so any evidence swap
// is detectable (honesty rule: no hardcoded trust booleans).
//
// MandateRecord represents a principal-signed D5 capability mandate that scopes the
// agent to a specific skill and benchmark.

// ─── DimensionId / DimensionStatus ──────────────────────────────────────────

/** The six passport dimensions, D1 through D6. */
export type DimensionId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

/**
 * Lifecycle status of a single dimension check.
 *  PASS    — evidence obtained and accepted
 *  FAIL    — evidence obtained but did not meet the bar
 *  REVIEW  — evidence obtained; flagged for human review (e.g. AML REVIEW band)
 *  PENDING — evidence requested but not yet obtained
 *  DENY    — hard-deny (e.g. AML DENY hit)
 */
export type DimensionStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'PENDING' | 'DENY';

// ─── DimensionRecord ─────────────────────────────────────────────────────────

/**
 * A single dimension's evidence record inside the passport bundle.
 *
 * `issuer`      — named external authority (e.g. 'Zefix', 'World ID', 'Public XRPL', 'OFAC SDN')
 * `evidenceRef` — human-readable pointer to the evidence artifact (UID, nullifier, tx hash, …)
 * `evidenceHash`— SHA-256 hex (64 chars) of the raw evidence artifact so any swap is detectable
 * `details`     — dimension-specific structured data (kept off-ledger; only the hash goes on-chain)
 * `checkedAt`   — unix milliseconds when the check was performed
 */
export interface DimensionRecord {
  id: DimensionId;
  status: DimensionStatus;
  /** Named external issuer — never an anonymous 'system'. */
  issuer: string;
  /** Pointer to the evidence artifact (UID, nullifier hash, XRPL tx hash, …). */
  evidenceRef: string;
  /** SHA-256 hex (64 chars) of the raw evidence artifact. */
  evidenceHash: string;
  /** Dimension-specific structured data. PII stays here (off-ledger). */
  details: Record<string, unknown>;
  /** Unix milliseconds when this check was performed. */
  checkedAt: number;
}

// ─── MandateRecord ───────────────────────────────────────────────────────────

/**
 * A principal-signed D5 capability mandate.
 *
 * Scopes the agent to a specific skill (identified by `skillId` + `skillVersion`)
 * and a benchmark artifact (identified by `benchmarkHash`). The principal signs
 * the tuple { agentKey, skillId, benchmarkHash } with their Ed25519 key.
 *
 * In production the signature would be verified server-side against the principal's
 * published public key. For the hackathon, field presence is the wire contract.
 */
export interface MandateRecord {
  /** Identifier of the skill the agent is authorised to execute. */
  skillId: string;
  /** Semver version of the skill. */
  skillVersion: string;
  /** SHA-256 hex of the benchmark artifact the principal attested to. */
  benchmarkHash: string;
  /** Ed25519 hex signature: principal signs { agentKey, skillId, benchmarkHash }. */
  principalSig: string;
  /** Unix milliseconds when the mandate was issued. */
  issuedAt: number;
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Construct a DimensionRecord for the given dimension id.
 * All fields in `fields` are passed through verbatim; `id` is injected.
 */
export function buildDimensionRecord(
  id: DimensionId,
  fields: Omit<DimensionRecord, 'id'>,
): DimensionRecord {
  return { id, ...fields };
}

/** Dimension ordering for the 6-bit bitmask: D1=bit0, D2=bit1, …, D6=bit5. */
const DIM_BIT: Record<DimensionId, number> = {
  D1: 0,
  D2: 1,
  D3: 2,
  D4: 3,
  D5: 4,
  D6: 5,
};

/**
 * Compute a 6-bit bitmask indicating which dimensions PASS.
 *
 * Bit layout: D1=bit0 (LSB), D2=bit1, D3=bit2, D4=bit3, D5=bit4, D6=bit5.
 *
 * Only PASS status sets the bit; FAIL, PENDING, REVIEW, and DENY do not.
 * This bitmask is stored in the v3 on-ledger codec as the `dx` field.
 */
export function dimsBitmask(dims: DimensionRecord[]): number {
  let mask = 0;
  for (const dim of dims) {
    if (dim.status === 'PASS') {
      mask |= 1 << DIM_BIT[dim.id];
    }
  }
  return mask;
}
