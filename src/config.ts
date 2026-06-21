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
  // World ID IDKit v4 — backend-only signing key must NEVER be sent to the frontend.
  // WORLDID_RP_SIGNING_KEY is the canonical name. WORLDID_KEY is kept as a legacy
  // fallback for existing .env files predating the rename; it is not listed in
  // .env.example, so new installs will not see it. No behavioural difference.
  worldId: {
    rpSigningKey: process.env.WORLDID_RP_SIGNING_KEY ?? process.env.WORLDID_KEY ?? '',
    rpId: process.env.WORLDID_RP_ID ?? '',
    appId: process.env.WORLDID_APP_ID ?? '',
    action: process.env.WORLDID_ACTION ?? 'meshcredit-agent-verify',
  },
  // Zefix KYB REST API (https://www.zefix.admin.ch/ZefixPublicREST/api/v1).
  // Falls back to fixture when credentials are absent or ZEFIX_FIXTURE=true.
  zefix: {
    username: process.env.ZEFIX_USERNAME ?? '',
    password: process.env.ZEFIX_PASSWORD ?? '',
    useFixture: process.env.ZEFIX_FIXTURE === 'true',
  },
  // AML sanctions screening — OpenSanctions OFAC SDN snapshot.
  // Uses the small JSON fixture when SANCTIONS_FIXTURE=true or the full CSV is absent.
  aml: {
    snapshotPath: process.env.SANCTIONS_SNAPSHOT_PATH ?? 'data/sanctions_snapshot_20260621.csv',
    useFixture: process.env.SANCTIONS_FIXTURE === 'true',
  },
  // Thick-file demo agent — pre-seeded by scripts/seed-thick-agent.ts.
  // Address stored in .thick-agent.json (gitignored) and optionally overridden by env.
  thickAgent: {
    address: process.env.THICK_AGENT_ADDR ?? '',
  },
};

export function assetLabel(a: Asset = CONFIG.asset): string {
  return a.kind === 'XRP' ? 'XRP' : `${a.currency} (RLUSD stand-in)`;
}

// ── Integration status ────────────────────────────────────────────────────────
// Returns a summary object showing which integrations are live (real credentials
// set) vs fallback. Called at server startup to print a clear log.
export interface IntegrationStatus {
  worldId: { live: boolean; rpId: string };
  zefix: { live: boolean; useFixture: boolean };
  aml: { live: boolean; snapshotPath: string };
  deepseek: { live: boolean };
}

/** Pure computation — accepts slices of the config so tests can inject known values. */
export interface IntegrationStatusInput {
  worldId: { rpSigningKey: string; rpId: string };
  zefix: { username: string; password: string; useFixture: boolean };
  aml: { useFixture: boolean; snapshotPath: string };
  deepseek: { apiKey: string };
}

export function computeIntegrationStatus(cfg: IntegrationStatusInput): IntegrationStatus {
  return {
    worldId: {
      live: cfg.worldId.rpSigningKey !== '' && cfg.worldId.rpId !== '',
      rpId: cfg.worldId.rpId || '(not set)',
    },
    zefix: {
      live: cfg.zefix.username !== '' && cfg.zefix.password !== '' && !cfg.zefix.useFixture,
      useFixture: cfg.zefix.useFixture || cfg.zefix.username === '',
    },
    aml: {
      // "live" means: fixture mode is explicitly off AND the full snapshot file exists.
      live: !cfg.aml.useFixture && existsSync(cfg.aml.snapshotPath),
      snapshotPath: cfg.aml.snapshotPath,
    },
    deepseek: {
      live: cfg.deepseek.apiKey !== '',
    },
  };
}

export function integrationStatus(): IntegrationStatus {
  return computeIntegrationStatus(CONFIG);
}
