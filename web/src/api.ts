// Thin client for the MeshCredit treasury API + live SSE feed.

// v2 tier names (BRONZE→PLATINUM). Old TIER-N names kept as union members
// for backward compatibility with any cached data that still uses them.
export type PassportTier = 'DENIED' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
export type Tier = PassportTier | 'TIER-1' | 'TIER-2' | 'TIER-3' | 'TIER-4';

export interface Terms { v: number; tier: Tier; maxTxAmount: string; score: number; exp: number; ref: string; }
export interface SkillTerms { v: number; skillId: string; skillVersion: string; benchmarkHash: string; exp: number; }
export interface Health { ok: boolean; network: string; asset: string; treasury: string; bank: string; }
export interface Payment {
  id: string; agentAddr: string; recipientAddr: string; amount: string; currency: string;
  status: string; createdAt: number; escrowHash?: string; finishHash?: string;
}
export interface GateResult { allowed: boolean; tier: Tier | null; reason: string; }

// ── Dimension types (mirror of backend src/kya/dimension.ts) ──
export type DimensionId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';
export type DimensionStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'PENDING' | 'DENY';

/** A single dimension's evidence record from the passport bundle. */
export interface DimensionRecord {
  id: DimensionId;
  status: DimensionStatus;
  /** Named external issuer (e.g. 'Zefix', 'World ID', 'Public XRPL', 'OFAC SDN'). */
  issuer: string;
  /** Human-readable pointer to the evidence artifact. */
  evidenceRef: string;
  /** SHA-256 hex of the raw evidence artifact. */
  evidenceHash: string;
  /** Dimension-specific structured data (PII stays off-ledger). */
  details: Record<string, unknown>;
  /** Unix milliseconds when the check was performed. */
  checkedAt: number;
}

const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const POST = (p: string, body?: object) =>
  fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(j);

export const api = {
  health: (): Promise<Health> => fetch('/api/health').then(j),
  createAgent: (): Promise<{ address: string; did: string }> => POST('/api/agent/create'),
  // Certify (if needed) → gate-check (incl. amount) → escrow the funds at the bank's gate.
  initiatePayment: (agentAddr: string, recipientAddr: string, amount = '50'): Promise<any> =>
    POST('/api/payment/initiate', { agentAddr, recipientAddr, amount }),
  // Bank approves → release into the gated account (succeeds only with a valid credential).
  approvePayment: (id: string): Promise<any> => POST('/api/payment/approve', { id }),
  // Reject → cancel the escrow → funds refund to the sender.
  rejectPayment: (id: string): Promise<any> => POST('/api/payment/reject', { id }),
  payments: (): Promise<{ payments: Payment[] }> => fetch('/api/payments').then(j),
  certifySkill: (agentAddr: string, skillId: string): Promise<any> =>
    POST('/api/skill/certify', { agentAddr, skillId }),
  skill: (agentAddr: string): Promise<{ skill: { credId: string; accepted: boolean; terms: SkillTerms } | null }> =>
    fetch('/api/skill/' + agentAddr).then(j),
  kill: (agentAddr: string) => POST('/api/killswitch', { agentAddr }),
  credential: (agentAddr: string): Promise<{ credential: { credId: string; accepted: boolean; terms: Terms } | null }> =>
    fetch('/api/credential/' + agentAddr).then(j),
  // Read-only gate check (tier + maxTxAmount).
  gate: (agentAddr: string, tier: Tier = 'TIER-1', amount?: string): Promise<GateResult> =>
    fetch(`/api/domain/gate/${agentAddr}?tier=${tier}` + (amount ? `&amount=${amount}` : '')).then(j),
};

// ── Live Demo Theater: the streamed cross-border scenario ──
export interface DemoStep {
  id: string;
  seq: number;
  phase: 'setup' | 'identity' | 'reasoning' | 'payment' | 'contrast' | 'governance' | 'error';
  actor: string;
  title: string;
  body?: string;
  status: 'active' | 'done' | 'denied' | 'info';
  tx?: { kind: string; label: string; hash: string; url: string };
  data?: Record<string, any> & {
    /** Six-dimension passport breakdown (v2 scenario). */
    dimensions?: DimensionRecord[];
    /** Confidence percentage (0-100) from the tier engine. */
    confidence?: number;
    /** v3 tier name (BRONZE/SILVER/GOLD/PLATINUM/DENIED). */
    tier_v3?: PassportTier;
  };
}
/** Kick off the streamed cross-border scenario (progress arrives over SSE). */
export const runDemo = (): Promise<{ started?: boolean; error?: string }> => POST('/api/demo/run');

export function subscribe(onEvent: (e: any) => void): () => void {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
  return () => es.close();
}

export const explorerTx = (h: string) => `https://testnet.xrpl.org/transactions/${h}`;
export const explorerAcct = (a: string) => `https://testnet.xrpl.org/accounts/${a}`;
export const short = (s: string, n = 6) => (s ? `${s.slice(0, n)}…${s.slice(-4)}` : '');
