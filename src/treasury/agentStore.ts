// File-backed persistence for managed demo-agent wallets so a server restart
// between /payment/initiate and /approve doesn't lose the agent's key (which
// previously 400'd the hero demo). Mirrors wallets.ts seed persistence.
import { Wallet } from 'xrpl';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export class AgentStore {
  constructor(private path: string) {}
  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>; } catch { return {}; }
  }
  private write(m: Record<string, string>): void { writeFileSync(this.path, JSON.stringify(m, null, 2)); }

  loadAll(): Map<string, Wallet> {
    const m = new Map<string, Wallet>();
    for (const [addr, seed] of Object.entries(this.read())) m.set(addr, Wallet.fromSeed(seed));
    return m;
  }
  add(w: Wallet): void { const m = this.read(); m[w.address] = w.seed as string; this.write(m); }
}
