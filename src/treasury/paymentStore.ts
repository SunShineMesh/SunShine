// File-backed payment-request ledger. Dependency-free JSON (mirrors store.ts) so
// the demo runs anywhere. Tracks a cross-border agent payment from initiation
// through the bank gate to release/refund.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type PaymentStatus = 'pending_bank' | 'approved' | 'rejected' | 'released' | 'refunded';

export interface PaymentRequest {
  id: string;
  agentAddr: string;        // the initiating agent (credential subject)
  senderAddr: string;       // Alice
  recipientAddr: string;    // Bob
  amount: string;
  currency: string;
  escrowSequence: number;   // EscrowCreate Sequence (OfferSequence for the finish)
  condition: string;        // PREIMAGE-SHA-256 condition
  fulfillment: string;      // the secret-revealing fulfillment (off-ledger until release)
  status: PaymentStatus;
  travelRulePayload: string;// FATF R16 originator/beneficiary data (structured; not verified in the demo)
  createdAt: number;        // unix ms
  escrowHash?: string;
  finishHash?: string;
}

export class PaymentStore {
  constructor(private path: string) {}

  private read(): PaymentRequest[] {
    if (!existsSync(this.path)) return [];
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as PaymentRequest[]; } catch { return []; }
  }
  private write(rows: PaymentRequest[]): void {
    writeFileSync(this.path, JSON.stringify(rows, null, 2));
  }

  create(p: PaymentRequest): PaymentRequest { const rows = this.read(); rows.push(p); this.write(rows); return p; }
  get(id: string): PaymentRequest | undefined { return this.read().find((x) => x.id === id); }
  byAgent(addr: string): PaymentRequest[] { return this.read().filter((x) => x.agentAddr === addr); }
  all(): PaymentRequest[] { return this.read(); }

  update(id: string, patch: Partial<PaymentRequest>): PaymentRequest {
    const rows = this.read();
    const i = rows.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`payment ${id} not found`);
    rows[i] = { ...rows[i], ...patch };
    this.write(rows);
    return rows[i];
  }
}
