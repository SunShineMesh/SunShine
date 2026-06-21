// D1 Principal model — discriminated union + control-proof verification.
//
// Pure-logic module; no I/O.
//
// A Principal is the human or organisation that CLAIMS to back an agent. Without
// a verifiable counter-signature linking the principal's identity to the agent's
// on-ledger key, the agent falls back to PSEUDONYMOUS — the lowest trust tier.
//
// Full Ed25519 signature verification is out of scope for the hackathon. The
// wire contract is: `counterSig` (or `delegationSig`) must be a non-empty hex
// string. Field presence is the binding; the spec notes the sig would be
// verified server-side against the principal's published public key in prod.

// ─── Public types ─────────────────────────────────────────────────────────────

/** The four principal categories. */
export type PrincipalKind = 'org' | 'individual' | 'parent-agent' | 'pseudonymous';

/** A verified legal entity (KYB track — D1 org). */
export interface OrgPrincipal {
  kind: 'org';
  /** Registry UID, e.g. 'CHE-103.867.266' */
  uid: string;
  /** True when the registry lookup confirmed status === 'ACTIVE'. */
  registryVerified: boolean;
  /** DNS TXT token or well-known path proving org controls the domain. */
  controlProofToken?: string;
  /** Ed25519 hex signature: principal signs agentKey bytes with its private key. */
  counterSig?: string;
}

/** A verified human (KYC / World ID track — D1+D2 individual). */
export interface IndividualPrincipal {
  kind: 'individual';
  /** World ID nullifier hash (D2 evidence); absent if D2 not yet done. */
  nullifierHash?: string;
  /** Optional DID reference for traditional identity docs. */
  didRef?: string;
  /** Ed25519 hex signature: individual signs agentKey. */
  counterSig?: string;
}

/** An agent backed by a parent agent's credential (delegation chain). */
export interface ParentAgentPrincipal {
  kind: 'parent-agent';
  /** credId of the parent agent's trust credential. */
  parentCredId: string;
  /** Ed25519 hex signature: parent agent signs child agentKey. */
  delegationSig?: string;
  /** Full delegation chain of agent addresses / identifiers back to a human/org. */
  chain?: string[];
}

/** No countersignature; always capped to the lowest trust tier (BRONZE). */
export interface PseudonymousPrincipal {
  kind: 'pseudonymous';
}

/** Discriminated union of all principal variants. */
export type Principal =
  | OrgPrincipal
  | IndividualPrincipal
  | ParentAgentPrincipal
  | PseudonymousPrincipal;

/** Result of `verifyControlProof`. */
export interface ControlProofResult {
  valid: boolean;
  /**
   * True iff the principal is pseudonymous; signals that the tier engine must
   * cap the tier at BRONZE regardless of D4/D5 maturity.
   */
  cappedToLowest?: boolean;
  /**
   * Delegation chain (for org and parent-agent principals).
   * For org: `[uid]`.
   * For parent-agent: the chain field from the principal, or `[parentCredId]`.
   */
  chain?: string[];
  /** Human-readable failure reason when `valid === false`. */
  reason?: string;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Verify that the principal can legitimately back the given `agentKey`.
 *
 * For `org` and `individual`: require a non-empty `counterSig` string.
 * For `parent-agent`: require a non-empty `delegationSig`.
 * For `pseudonymous`: always valid but flagged as capped to the lowest tier.
 *
 * In production, the server would verify the sig against the principal's
 * published Ed25519 public key. Here, field presence is the wire contract.
 */
export function verifyControlProof(principal: Principal, _agentKey: string): ControlProofResult {
  switch (principal.kind) {
    case 'org': {
      if (!principal.counterSig || principal.counterSig.trim() === '') {
        return {
          valid: false,
          reason: 'missing counter-signature — principal cannot back this agent',
        };
      }
      return {
        valid: true,
        chain: [principal.uid],
      };
    }

    case 'individual': {
      if (!principal.counterSig || principal.counterSig.trim() === '') {
        return {
          valid: false,
          reason: 'missing counter-signature — principal cannot back this agent',
        };
      }
      return {
        valid: true,
        chain: principal.nullifierHash ? [principal.nullifierHash] : [],
      };
    }

    case 'parent-agent': {
      if (!principal.delegationSig || principal.delegationSig.trim() === '') {
        return {
          valid: false,
          reason: 'missing delegation signature — parent agent cannot delegate to this agent',
        };
      }
      const chain = principal.chain ?? [principal.parentCredId];
      return {
        valid: true,
        chain,
      };
    }

    case 'pseudonymous': {
      return {
        valid: true,
        cappedToLowest: true,
        chain: [],
      };
    }
  }
}

/**
 * Return the length of a delegation chain.
 *
 * A chain of `['rHuman', 'rParent', 'rChild']` has depth 3.
 */
export function delegationDepth(chain: string[]): number {
  return chain.length;
}

/**
 * True iff the principal is pseudonymous (no backing identity).
 * Used by the tier engine to enforce the BRONZE cap.
 */
export function principalIsPseudonymous(p: Principal): boolean {
  return p.kind === 'pseudonymous';
}
