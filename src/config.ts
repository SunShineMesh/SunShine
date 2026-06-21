// Central configuration. Settlement asset is XRP by default (simplest, no
// trustline setup) and switches to a self-issued IOU (RLUSD stand-in) once
// STABLE_ISSUER is set in the environment.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dependency-free .env loader so the lines printed by `npm run setup:stablecoin`
// can be dropped into meshcredit/.env and picked up here. Real env vars win; a
// missing file means XRP stays the default (the reliable demo path).
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV_PATH)) {
  for (const raw of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      if (process.env[k] === undefined) process.env[k] = line.slice(eq + 1).trim();
    }
  }
}

export type Asset =
  | { kind: 'XRP' }
  | { kind: 'IOU'; currency: string; issuer: string };

export const CONFIG = {
  network: process.env.XRPL_WSS ?? 'wss://s.altnet.rippletest.net:51233',
  port: Number(process.env.PORT ?? 8787),
  asset: (process.env.STABLE_ISSUER
    ? { kind: 'IOU', currency: process.env.STABLE_CCY ?? 'USD', issuer: process.env.STABLE_ISSUER }
    : { kind: 'XRP' }) as Asset,
  explorerTx: (h: string) => `https://testnet.xrpl.org/transactions/${h}`,
  explorerAcct: (a: string) => `https://testnet.xrpl.org/accounts/${a}`,
  // DeepSeek (OpenAI-compatible) powers the agent's real reasoning. Key lives in
  // the gitignored .env (loaded above). Absent key → the agent brain degrades to
  // a clearly-labelled deterministic note (never silently fabricated).
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro',
    flashModel: process.env.DEEPSEEK_FLASH_MODEL ?? 'deepseek-v4-flash',
  },
};

export function assetLabel(a: Asset = CONFIG.asset): string {
  return a.kind === 'XRP' ? 'XRP' : `${a.currency} (RLUSD stand-in)`;
}
