// Wallet funding (testnet faucet, with retries) + optional seed persistence so
// long-lived demo roles (treasury, stablecoin issuer) survive across runs.
import { Client, Wallet } from 'xrpl';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WALLETS_PATH = fileURLToPath(new URL('../../.wallets.json', import.meta.url));
type Seeds = Record<string, string>;
const readSeeds = (): Seeds => (existsSync(WALLETS_PATH) ? JSON.parse(readFileSync(WALLETS_PATH, 'utf8')) : {});
const writeSeeds = (s: Seeds) => writeFileSync(WALLETS_PATH, JSON.stringify(s, null, 2));

export async function fundNew(client: Client, name = 'wallet'): Promise<Wallet> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const { wallet } = await client.fundWallet();
      return wallet;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`could not fund ${name}: ${(lastErr as Error)?.message}`);
}

/** Load a persisted wallet by name, or fund a new one and persist its seed. */
export async function loadOrFund(client: Client, name: string): Promise<Wallet> {
  const seeds = readSeeds();
  if (seeds[name]) return Wallet.fromSeed(seeds[name]);
  const w = await fundNew(client, name);
  seeds[name] = w.seed as string;
  writeSeeds(seeds);
  return w;
}
