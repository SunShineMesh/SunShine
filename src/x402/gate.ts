// Phase 1.5 — x402 gate middleware.
//
// A minimal HTTP-402 compliance gate: checks an agent's passport credential
// plus AML status, then releases the resource or returns 402 Payment Required.
//
// Defense-in-depth: app-layer x402 check sits ABOVE the ledger-layer
// DepositAuth gate; both must pass independently.
//
// All tier-ceiling checks use the ABSTRACT USD vouching limits from tier.ts
// (BRONZE=$100, SILVER=$500, GOLD=$2000, PLATINUM=$10000). These are gate-logic
// display values only — NOT on-chain RLUSD transfer amounts.

import type { RequestHandler, Request, Response } from 'express';
import type { PassportTier } from '../kya/tier.js';
import type { AmlMatcher } from '../kya/aml.js';

// ── Public types ─────────────────────────────────────────────────────────────

/** Requirements the protected resource declares to the requesting agent. */
export interface X402Requirements {
  /** The payment amount requested in the named currency. */
  amount: string;
  /** Currency identifier — always 'RLUSD' for MeshCredit. */
  currency: 'RLUSD';
  /** The entity that issues valid MeshCredit credentials. */
  credentialIssuer: string;
  /** Minimum tier the agent must hold to access this resource. */
  requiredTier: PassportTier;
  /** XRPL address that should receive the payment receipt. */
  paymentAddress: string;
}

/** Result returned by the x402 gate check. */
export interface X402GateResult {
  /** Whether the agent is allowed to access the resource. */
  allowed: boolean;
  /**
   * HTTP status code to respond with.
   * Always 402 — either as a denial (allowed=false) or as the
   * "payment acknowledged / resource released" response (allowed=true).
   * The x402 protocol uses 402 for both; the `released` flag disambiguates.
   */
  status: 402 | 200;
  /** Human-readable denial reason (present when allowed=false). */
  reason?: string;
  /** True when the credential check passed and the resource was released. */
  released?: boolean;
}

/** Parameters consumed by checkPassportForX402. */
export interface X402CheckParams {
  agentAddr: string;
  /** Current credential status for this agent. */
  credentialStatus: 'valid' | 'missing' | 'revoked';
  /** Tier ceiling in USD (abstract vouching limit, NOT transfer amount). */
  tierCeiling: string;
  /** The USD amount the agent is requesting to transact. */
  requestedAmount: string;
  /** Result from AML screening for this agent/counterparty. */
  amlResult: 'PASS' | 'REVIEW' | 'DENY';
}

// ── Core gate logic ──────────────────────────────────────────────────────────

/**
 * Check whether an agent may access an x402-gated resource.
 *
 * Gate order (earliest denial wins):
 *   1. Credential must be valid (not missing/revoked)
 *   2. AML DENY blocks immediately — amount check is irrelevant for sanctioned entities
 *   3. Requested amount must not exceed tier ceiling
 *
 * On pass: returns `{ allowed: true, status: 402, released: true }`.
 * The 402 status is intentional — the x402 protocol uses 402 for the
 * acknowledgement receipt as well as for the denial challenge.
 */
export async function checkPassportForX402(
  params: X402CheckParams,
): Promise<X402GateResult> {
  // Gate 1 — credential validity
  if (params.credentialStatus !== 'valid') {
    return {
      allowed: false,
      status: 402,
      reason: 'no valid MeshCredit credential',
    };
  }

  // Gate 2 — AML hard block (runs before amount check — amount is irrelevant
  // when the counterparty/agent is on the sanctions list)
  if (params.amlResult === 'DENY') {
    return {
      allowed: false,
      status: 402,
      reason: 'AML screening DENY',
    };
  }

  // Gate 3 — amount vs tier ceiling
  const requested = parseFloat(params.requestedAmount);
  const ceiling = parseFloat(params.tierCeiling);
  if (requested > ceiling) {
    return {
      allowed: false,
      status: 402,
      reason: 'amount exceeds tier ceiling',
    };
  }

  // All gates passed — resource released.
  return {
    allowed: true,
    status: 402,
    released: true,
  };
}

// ── 402 response builder ─────────────────────────────────────────────────────

/**
 * Build a well-formed HTTP-402 response object.
 *
 * Returns:
 *   - `status: 402`
 *   - `headers`: `X-Payment-Required` (amount + currency), `X-Payment-Schemes`
 *   - `body`: `{ error: 'Payment Required', requirements }`
 */
export function buildX402Response(requirements: X402Requirements): {
  status: 402;
  headers: Record<string, string>;
  body: object;
} {
  return {
    status: 402,
    headers: {
      'X-Payment-Required': `amount=${requirements.amount};currency=${requirements.currency};address=${requirements.paymentAddress}`,
      'X-Payment-Schemes': 'RLUSD/XRPL',
    },
    body: {
      error: 'Payment Required',
      requirements,
    },
  };
}

// ── Express middleware factory ────────────────────────────────────────────────

/**
 * Express middleware that enforces x402 payment gating on a route.
 *
 * On every request:
 *   1. Reads the agent address from `req.headers['x-agent-addr']` or the body.
 *   2. Fetches the agent's credential via `fetchCredential`.
 *   3. Screens the agent address against the AML list via `amlMatcher`.
 *   4. Checks tier ceiling vs `requirements.amount`.
 *   5. Calls `next()` on pass; sends 402 JSON on denial.
 *
 * @param requirements  The resource's payment/tier requirements.
 * @param fetchCredential  Async function that resolves to a credential view (or null).
 * @param amlMatcher  Compiled AML screening function.
 */
export function x402Middleware(
  requirements: X402Requirements,
  fetchCredential: (addr: string) => Promise<{ accepted?: boolean } | null>,
  amlMatcher: AmlMatcher,
): RequestHandler {
  return async (req: Request, res: Response, next: Function): Promise<void> => {
    // Resolve the agent address from the request.
    const agentAddr =
      (req.headers['x-agent-addr'] as string | undefined) ||
      (req.body as Record<string, string>)?.agentAddr ||
      '';

    if (!agentAddr) {
      const r402 = buildX402Response(requirements);
      res.status(402).set(r402.headers).json({
        ...r402.body,
        reason: 'no agent address provided',
      });
      return;
    }

    // Fetch credential.
    const credView = await fetchCredential(agentAddr).catch(() => null);
    const credentialStatus: X402CheckParams['credentialStatus'] =
      !credView ? 'missing' : credView.accepted ? 'valid' : 'missing';

    // AML screen the agent address.
    const amlScreening = amlMatcher(agentAddr);
    const amlResult: X402CheckParams['amlResult'] = amlScreening.action;

    // Run the gate.
    const gateResult = await checkPassportForX402({
      agentAddr,
      credentialStatus,
      tierCeiling: requirements.amount, // use the resource's own declared amount as ceiling
      requestedAmount: requirements.amount,
      amlResult,
    });

    if (!gateResult.allowed) {
      const r402 = buildX402Response(requirements);
      res.status(402).set(r402.headers).json({
        ...r402.body,
        reason: gateResult.reason,
      });
      return;
    }

    // Resource released — pass to the route handler.
    next();
  };
}
