import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'xrpl';
import { AgentStore } from '../src/treasury/agentStore.js';

describe('AgentStore', () => {
  it('persists a wallet seed and reloads it as a usable Wallet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-'));
    try {
      const path = join(dir, '.agents.json');
      const w = Wallet.generate();
      new AgentStore(path).add(w);
      const loaded = new AgentStore(path).loadAll();
      expect(loaded.has(w.address)).toBe(true);
      expect(loaded.get(w.address)!.address).toBe(w.address);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('loadAll on a missing file returns an empty map', () => {
    expect(new AgentStore(join(tmpdir(), 'nope-' + process.pid + '.json')).loadAll().size).toBe(0);
  });
});
