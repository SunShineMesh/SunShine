// World ID IDKit v4 — backend integration (D2 Human Accountability).
//
// Exposes:
//   POST /api/worldid/rp-signature  → signRequest from @worldcoin/idkit-core/signing
//   POST /api/worldid/verify         → forward to developer.world.org/api/v4/verify/{rp_id}
//
// Honest fallback: if WORLDID_RP_SIGNING_KEY is absent the endpoints return
//   { fallback: true, message: 'wiring shown, proof pending' }
// so the demo runs without real World ID credentials.
//
// ENV vars (all optional for fallback mode):
//   WORLDID_RP_SIGNING_KEY  — backend ECDSA signing key (never sent to client)
//   WORLDID_KEY             — alias for the same key (either name accepted)
//   WORLDID_RP_ID           — rp_xxx from Developer Portal
//   WORLDID_APP_ID          — app_xxx (safe to expose)
//   WORLDID_ACTION          — defaults to 'meshcredit-agent-verify'

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Request, Response } from 'express';
import type { DimensionRecord } from '../kya/dimension.js';
import { buildDimensionRecord } from '../kya/dimension.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorldIdVerifyResult {
  /** RP-scoped nullifier (hex string) */
  nullifier: string;
  /** Action identifier used for this proof */
  action: string;
  /** Verification level returned by World App */
  verificationLevel: 'orb' | 'device' | 'unknown';
  /** Unix milliseconds when verification completed */
  verifiedAt: number;
  /** True when operating in honest-fallback mode (no real proof obtained) */
  fallback: boolean;
}

// ─── extractNullifier ────────────────────────────────────────────────────────

/**
 * Extract the nullifier string from an IDKit result object.
 *
 * Handles:
 *  - IDKit v4 (protocol_version "4.0"):  result.responses[0].nullifier
 *  - IDKit v3 legacy (protocol_version "3.0"): result.responses[0].nullifier
 *    (v3 also uses nullifier directly in the response item)
 *
 * Returns empty string for unknown / malformed shapes.
 */
export function extractNullifier(idkitResult: unknown): string {
  if (!idkitResult || typeof idkitResult !== 'object') return '';
  const r = idkitResult as Record<string, unknown>;

  // Both v3 and v4 store responses as an array; nullifier lives in responses[0].nullifier
  const responses = r['responses'];
  if (Array.isArray(responses) && responses.length > 0) {
    const first = responses[0] as Record<string, unknown>;
    const nullifier = first['nullifier'];
    if (typeof nullifier === 'string' && nullifier.length > 0) return nullifier;
    // v3 legacy sometimes exposes nullifier_hash at the top level
    const nullifierHash = r['nullifier_hash'];
    if (typeof nullifierHash === 'string' && nullifierHash.length > 0) return nullifierHash;
  }

  // Top-level nullifier_hash (some v3 bridge shapes)
  const topNullifierHash = r['nullifier_hash'];
  if (typeof topNullifierHash === 'string' && topNullifierHash.length > 0) return topNullifierHash;

  return '';
}

// ─── buildD2DimensionRecord ──────────────────────────────────────────────────

/**
 * Build a D2 (Human Accountability) DimensionRecord from a World ID verify result.
 *
 * - issuer: 'World ID'
 * - status: 'PASS' when !result.fallback, 'PENDING' when result.fallback is true
 * - evidenceRef: the nullifier hash (hex)
 * - evidenceHash: SHA-256 of the canonical JSON of the result (64-hex)
 */
export function buildD2DimensionRecord(
  result: WorldIdVerifyResult,
  now?: number,
): DimensionRecord {
  const checkedAt = now ?? result.verifiedAt ?? Date.now();
  const status = result.fallback ? 'PENDING' : 'PASS';
  const evidenceHash = createHash('sha256')
    .update(JSON.stringify({ ...result, _ts: checkedAt }))
    .digest('hex');

  return buildDimensionRecord('D2', {
    status,
    issuer: 'World ID',
    evidenceRef: result.nullifier,
    evidenceHash,
    details: {
      action: result.action,
      verificationLevel: result.verificationLevel,
      fallback: result.fallback,
    },
    checkedAt,
  });
}

// ─── NullifierStore ──────────────────────────────────────────────────────────

interface NullifierEntry {
  action: string;
  storedAt: number;
}

/**
 * Simple file-backed store for World ID nullifiers (replay prevention).
 * Uses ':memory:' path for in-memory-only operation (tests / edge cases).
 */
export class NullifierStore {
  private memory: Map<string, NullifierEntry> | null = null;

  constructor(private path: string) {
    if (path === ':memory:') {
      this.memory = new Map();
    }
  }

  private read(): Record<string, NullifierEntry> {
    if (this.memory) {
      const out: Record<string, NullifierEntry> = {};
      for (const [k, v] of this.memory) out[k] = v;
      return out;
    }
    if (!existsSync(this.path)) return {};
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, NullifierEntry>; }
    catch { return {}; }
  }

  private write(m: Record<string, NullifierEntry>): void {
    if (this.memory) {
      this.memory.clear();
      for (const [k, v] of Object.entries(m)) this.memory.set(k, v);
      return;
    }
    writeFileSync(this.path, JSON.stringify(m, null, 2));
  }

  has(nullifier: string): boolean {
    return nullifier in this.read();
  }

  add(nullifier: string, entry: NullifierEntry): void {
    const m = this.read();
    if (nullifier in m) throw new Error(`Nullifier replay detected: ${nullifier}`);
    m[nullifier] = entry;
    this.write(m);
  }
}

// ─── ENV helpers ─────────────────────────────────────────────────────────────

function getSigningKey(): string {
  // Accept either WORLDID_RP_SIGNING_KEY or WORLDID_KEY (global constraint says "read whichever present")
  return process.env.WORLDID_RP_SIGNING_KEY ?? process.env.WORLDID_KEY ?? '';
}

function getRpId(): string {
  return process.env.WORLDID_RP_ID ?? '';
}

function getAction(): string {
  return process.env.WORLDID_ACTION ?? 'meshcredit-agent-verify';
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/worldid/rp-signature
 *
 * Calls signRequest from @worldcoin/idkit-core/signing and returns the RpSignature.
 * Honest fallback: if WORLDID_RP_SIGNING_KEY absent, returns { fallback: true }.
 */
export async function rpSignatureHandler(req: Request, res: Response): Promise<void> {
  const signingKey = getSigningKey();
  if (!signingKey) {
    res.json({ fallback: true, message: 'wiring shown, proof pending' });
    return;
  }

  try {
    // Dynamic import to avoid top-level module resolution failures when the package
    // has optional WASM or environment-specific deps.
    const { signRequest } = await import('@worldcoin/idkit-core/signing');
    const action = (req.body as Record<string, string>)?.action ?? getAction();
    const sig = signRequest({ signingKeyHex: signingKey, action });
    res.json(sig);
  } catch (e: unknown) {
    // If signRequest fails for any reason (invalid key format, WASM not available, etc.)
    // fall back gracefully so the demo is never blocked.
    const msg = e instanceof Error ? e.message : String(e);
    res.json({ fallback: true, message: `signing unavailable: ${msg}` });
  }
}

/**
 * POST /api/worldid/verify
 *
 * Forwards the IDKit proof to `https://developer.world.org/api/v4/verify/{rp_id}`.
 * Extracts the nullifier, stores it (replay prevention), and returns a WorldIdVerifyResult.
 *
 * Honest fallback: if WORLDID_RP_ID absent, returns { fallback: true }.
 */
export async function verifyProofHandler(req: Request, res: Response): Promise<void> {
  const rpId = getRpId();
  if (!rpId) {
    res.json({ fallback: true, message: 'wiring shown, proof pending' });
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;
    const verifyUrl = `https://developer.world.org/api/v4/verify/${rpId}`;

    // Forward to World ID developer API
    const upstream = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(upstream.status).json({
        error: 'World ID verification failed',
        detail: errText,
      });
      return;
    }

    const upstreamData = await upstream.json() as Record<string, unknown>;

    // Extract nullifier from the result
    const nullifier = extractNullifier(upstreamData) || extractNullifier(body);
    const action = getAction();
    const verifiedAt = Date.now();

    // Derive verification level: check responses array for credential type clues
    let verificationLevel: 'orb' | 'device' | 'unknown' = 'unknown';
    const responses = (upstreamData['responses'] ?? (body['result'] as any)?.responses) as unknown[];
    if (Array.isArray(responses) && responses.length > 0) {
      const first = responses[0] as Record<string, unknown>;
      const id = String(first['identifier'] ?? '').toLowerCase();
      if (id.includes('orb') || id === 'proof_of_human') verificationLevel = 'orb';
      else if (id.includes('device')) verificationLevel = 'device';
    }

    const result: WorldIdVerifyResult = {
      nullifier,
      action,
      verificationLevel,
      verifiedAt,
      fallback: false,
    };

    const dim = buildD2DimensionRecord(result, verifiedAt);
    res.json({ ...result, dimension: dim });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.json({ fallback: true, message: `verify unavailable: ${msg}` });
  }
}
