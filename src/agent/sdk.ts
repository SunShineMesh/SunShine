// MeshCredit SDK — give an AI agent a portable trust credential in a few lines.
//
//   import { MeshCredit } from 'meshcredit';
//   const mc = new MeshCredit();
//   await mc.register();                                       // KYA + on-ledger trust credential
//   const { payment } = await mc.payment.initiate(bob, '50');  // funds held at the bank's gate
//   await mc.payment.approve(payment.id);                      // certified → released through the bank
//   await mc.skill.certify('pdf-extract');                     // attest a specialized skill (UC2)
//
// In production the agent holds its own XRPL key and signs client-side; this SDK
// talks to a MeshCredit treasury endpoint.

export interface MeshCreditOptions {
  serverUrl?: string;
}

export class MeshCredit {
  private base: string;
  agentAddr?: string;
  did?: string;

  /** Nested operator (KYB) sub-namespace. */
  readonly operator: OperatorNamespace;
  /** Domain/access-control sub-namespace. */
  readonly domain: DomainNamespace;
  /** Cross-border payment sub-namespace. */
  readonly payment: PaymentNamespace;
  /** Skill-credential (UC2) sub-namespace. */
  readonly skill: SkillNamespace;

  constructor(opts: MeshCreditOptions = {}) {
    this.base = opts.serverUrl ?? process.env.MESHCREDIT_URL ?? 'http://localhost:8787';
    this.operator = new OperatorNamespace(this);
    this.domain = new DomainNamespace(this);
    this.payment = new PaymentNamespace(this);
    this.skill = new SkillNamespace(this);
  }

  /** @internal */
  async req(path: string, method = 'GET', body?: object): Promise<any> {
    const r = await fetch(this.base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  }

  /** Register the agent: funds a wallet, runs KYA, returns its DID + address. */
  async register(opts: { operator?: string } = {}): Promise<{ address: string; did: string }> {
    const a = await this.req('/api/agent/create', 'POST', {});
    this.agentAddr = a.address;
    this.did = a.did;
    // If an operator address is provided, record it on the SDK instance so
    // subsequent draw() calls can pass it to the origination endpoint.
    if (opts.operator) {
      (this as any)._operatorAddr = opts.operator;
    }
    return a;
  }

  /** Preview the credit decision without drawing. */
  async check(offChain: Record<string, unknown> = {}) {
    return this.req('/api/kya/evaluate', 'POST', { agentAddr: this.agentAddr, offChain });
  }

  /** Read any agent's on-ledger trust credential (the public bureau). */
  async credential(agentAddr = this.agentAddr) {
    const r = await this.req('/api/credential/' + agentAddr);
    return r.credential as { credId: string; accepted: boolean; terms: any } | null;
  }
}

/** Operator KYB sub-namespace exposed via mc.operator.* */
class OperatorNamespace {
  constructor(private mc: MeshCredit) {}

  /**
   * Run KYB and issue an operator_v1 credential to the given business address.
   * Returns { hash, btier, maxDelegatedSpend }.
   */
  async onboard(operatorAddr: string, kybSignals: Record<string, unknown>) {
    return this.mc.req('/api/operator/onboard', 'POST', { operatorAddr, kybSignals });
  }

  /**
   * Verify a business has a valid (accepted) operator_v1 credential on-ledger.
   * Returns { verified, btier, maxDelegatedSpend } or { verified: false, reason }.
   */
  async verify(operatorAddr: string) {
    return this.mc.req('/api/operator/verify', 'POST', { operatorAddr });
  }

  /** Revoke an operator credential (kill-switch for the entire operator). */
  async revoke(operatorAddr: string) {
    return this.mc.req('/api/operator/revoke', 'POST', { operatorAddr });
  }
}

/** Permissioned Domain sub-namespace exposed via mc.domain.* */
class DomainNamespace {
  constructor(private mc: MeshCredit) {}

  /** Create the treasury's PermissionedDomain (one-time setup). */
  async create() {
    return this.mc.req('/api/domain/create', 'POST', {});
  }

  /**
   * Gate check: returns { allowed, tier, reason }.
   * allowed = true iff the agent holds a valid credential meeting requiredTier.
   * Domain access is automatically revoked when revokeCredential() is called
   * (CredentialDelete atomically removes the agent from every domain).
   */
  async gate(agentAddr: string, requiredTier = 'TIER-1', amount?: string) {
    const q = `?tier=${requiredTier}` + (amount ? `&amount=${amount}` : '');
    return this.mc.req(`/api/domain/gate/${agentAddr}${q}`);
  }
}

/** Cross-border payment sub-namespace exposed via mc.payment.* */
class PaymentNamespace {
  constructor(private mc: MeshCredit) {}

  /** Certify (if needed) → gate-check → lock funds in escrow at the bank's gate. */
  initiate(recipientAddr: string, amount = '50', travelRulePayload = '{}') {
    return this.mc.req('/api/payment/initiate', 'POST', { agentAddr: this.mc.agentAddr, recipientAddr, amount, travelRulePayload });
  }
  /** Bank approves → release into the gated account (succeeds only with a valid credential). */
  approve(id: string) { return this.mc.req('/api/payment/approve', 'POST', { id }); }
  /** Reject → cancel the escrow → funds refund to the sender. */
  reject(id: string) { return this.mc.req('/api/payment/reject', 'POST', { id }); }
  /** List all payment requests. */
  all() { return this.mc.req('/api/payments'); }
}

/** Skill-credential (UC2) sub-namespace exposed via mc.skill.* */
class SkillNamespace {
  constructor(private mc: MeshCredit) {}

  /** Attest a specialized skill for the registered agent (a second on-ledger credential). */
  certify(skillId: string, skillVersion = '1.0.0') {
    return this.mc.req('/api/skill/certify', 'POST', { agentAddr: this.mc.agentAddr, skillId, skillVersion });
  }
  /** Read any agent's skill credential. */
  of(agentAddr: string) { return this.mc.req('/api/skill/' + agentAddr); }
}
