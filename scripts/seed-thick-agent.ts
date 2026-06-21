#!/usr/bin/env tsx
/**
 * TASK 12 — Thick-file setup script
 *
 * Pre-seeds 35 real testnet XRP transactions (Payments + EscrowCreate/EscrowFinish)
 * on a dedicated thick-file agent wallet to build a genuine behavioral history that
 * produces GOLD-tier / high-confidence contrast in the demo scenario.
 *
 * Usage:
 *   npm run setup:thick-agent
 *
 * Idempotent: if .thick-agent.json already exists and settlementsCount >= 35, skips.
 *
 * RLUSD CONSERVATION: uses XRP (free testnet faucet) NOT RLUSD, per the constraint
 * in the global build rules. The demoAgent RLUSD balance is never touched here.
 *
 * The persistent record is stored at .thick-agent.json (gitignored).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, Wallet, xrpToDrops } from 'xrpl';
import { CONFIG } from '../src/config.js';
import { submit } from '../src/xrpl/client.js';
import { makePreimageCondition, toRippleEpoch } from '../src/xrpl/codec.js';

// ---------------------------------------------------------------------------
// Public constants + types (exported so tests can verify the contract)
// ---------------------------------------------------------------------------

export const THICK_AGENT_FILE = fileURLToPath(new URL('../.thick-agent.json', import.meta.url));

export const REQUIRED_SETTLEMENTS = 35;

export interface ThickAgentRecord {
  address: string;
  secret: string;
  settlementsCount: number;
  firstTxDate: string;  // ISO-8601 date of the first seeded transaction
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/** Return the persisted record, or null if the file does not exist or is unreadable. */
export function loadThickAgent(path: string = THICK_AGENT_FILE): ThickAgentRecord | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ThickAgentRecord;
  } catch {
    return null;
  }
}

function saveThickAgent(record: ThickAgentRecord, path: string = THICK_AGENT_FILE): void {
  writeFileSync(path, JSON.stringify(record, null, 2));
}

// ---------------------------------------------------------------------------
// XRPL helpers — pure XRP, no RLUSD
// ---------------------------------------------------------------------------

/** Fund a fresh testnet wallet (max 4 retries). */
async function fundNew(client: Client, label: string): Promise<Wallet> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const { wallet } = await client.fundWallet();
      console.log(`  Funded ${label}: ${wallet.address}`);
      return wallet;
    } catch (e) {
      lastErr = e;
      console.warn(`  fundWallet attempt ${i + 1} failed — retrying in 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`Could not fund ${label}: ${(lastErr as Error)?.message}`);
}

/** Send a tiny XRP Payment from agent → payee (not a self-loop). */
async function sendPayment(
  client: Client,
  agent: Wallet,
  payeeAddr: string,
  drops: string,
  seq: number,
): Promise<string> {
  const r = await submit(
    client,
    agent,
    {
      TransactionType: 'Payment',
      Account: agent.address,
      Destination: payeeAddr,
      Amount: drops,
    },
    `Payment #${seq}`,
  );
  return r.hash;
}

/**
 * EscrowCreate from agent → payee, then EscrowFinish immediately.
 * Uses a crypto-condition preimage so EscrowFinish is immediate (no FinishAfter).
 * The fulfillment-based finish requires a higher fee; autofill handles that via submit().
 */
async function sendEscrowPair(
  client: Client,
  agent: Wallet,
  payeeAddr: string,
  drops: string,
  seq: number,
): Promise<{ createHash: string; finishHash: string }> {
  const { condition, fulfillment } = makePreimageCondition();
  const cancelAfter = toRippleEpoch(Date.now() + 3600 * 1000); // 1 h safety net

  // EscrowCreate — autofill assigns a Sequence we need for the finish
  const prepared: any = await client.autofill({
    TransactionType: 'EscrowCreate',
    Account: agent.address,
    Destination: payeeAddr,
    Amount: drops,
    Condition: condition,
    CancelAfter: cancelAfter,
  });
  const escrowSequence: number = prepared.Sequence;
  const signed = agent.sign(prepared);
  const createRes = await client.submitAndWait(signed.tx_blob);
  const createCode = (createRes.result.meta as any)?.TransactionResult;
  if (createCode !== 'tesSUCCESS') {
    throw new Error(`EscrowCreate #${seq} failed: ${createCode}`);
  }
  const createHash = createRes.result.hash as string;

  // EscrowFinish
  const finishR = await submit(
    client,
    agent,
    {
      TransactionType: 'EscrowFinish',
      Account: agent.address,
      Owner: agent.address,
      OfferSequence: escrowSequence,
      Condition: condition,
      Fulfillment: fulfillment,
    },
    `EscrowFinish #${seq}`,
  );

  return { createHash, finishHash: finishR.hash };
}

// ---------------------------------------------------------------------------
// Main seeding logic
// ---------------------------------------------------------------------------

/**
 * Seed the thick-file agent.
 *
 * Strategy for 35 settlements:
 *   - 20 Payment transactions (cheap, fast)
 *   - 15 EscrowCreate + EscrowFinish pairs (each pair counts as 1 settlement
 *     because the EscrowFinish Destination ≠ agentAddr)
 * Total unique third-party outbound tx events ≥ 35.
 *
 * Amount per leg: 1 XRP drop (1e-6 XRP) — negligible, no waste.
 * Payee wallet is a separate throwaway wallet (also funded once, then reused).
 */
export async function seedThickAgent(opts: {
  targetPath?: string;
  requiredSettlements?: number;
} = {}): Promise<ThickAgentRecord> {
  const targetPath = opts.targetPath ?? THICK_AGENT_FILE;
  const required = opts.requiredSettlements ?? REQUIRED_SETTLEMENTS;

  // Idempotency check
  const existing = loadThickAgent(targetPath);
  if (existing && existing.settlementsCount >= required) {
    console.log(
      `Thick-file agent already seeded (${existing.settlementsCount} settlements). Skipping.`,
    );
    console.log(`  address: ${existing.address}`);
    return existing;
  }

  console.log(`\nMeshCredit — Thick-file Agent Setup`);
  console.log(`=====================================`);
  console.log(`Target: ${required} settlements on XRPL testnet (XRP only, no RLUSD)`);

  const client = new Client(CONFIG.network);
  await client.connect();
  console.log(`Connected to: ${CONFIG.network}`);

  try {
    // Fund the thick-file agent wallet
    const agent = await fundNew(client, 'thick-agent');

    // Fund a separate payee (not the agent itself — no self-loops per D4 derivation)
    const payee = await fundNew(client, 'thick-agent-payee');

    const firstTxDate = new Date().toISOString();
    let settlementsCount = 0;
    const DROPS = xrpToDrops('0.000001'); // 1 drop — negligible

    // 20 direct Payments
    console.log(`\nSeeding ${20} Payment transactions...`);
    for (let i = 1; i <= 20; i++) {
      const hash = await sendPayment(client, agent, payee.address, DROPS, i);
      settlementsCount++;
      console.log(`  [${i}/20] Payment OK  ${hash.slice(0, 12)}...  (total: ${settlementsCount})`);
    }

    // 15 EscrowCreate/EscrowFinish pairs
    console.log(`\nSeeding ${15} EscrowCreate+EscrowFinish pairs...`);
    for (let i = 1; i <= 15; i++) {
      const { createHash, finishHash } = await sendEscrowPair(
        client,
        agent,
        payee.address,
        DROPS,
        i,
      );
      settlementsCount++;
      console.log(
        `  [${i}/15] Escrow OK  create=${createHash.slice(0, 8)}...  finish=${finishHash.slice(0, 8)}...  (total: ${settlementsCount})`,
      );
    }

    const record: ThickAgentRecord = {
      address: agent.address,
      secret: agent.seed as string,
      settlementsCount,
      firstTxDate,
    };

    saveThickAgent(record, targetPath);
    console.log(`\nThick-file agent saved to: ${targetPath}`);
    console.log(`  address:    ${record.address}`);
    console.log(`  settlements: ${record.settlementsCount}`);
    console.log(`\nSet THICK_AGENT_ADDR=${record.address} in your .env to use in the demo.`);

    return record;
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run when executed directly (not when imported by tests or other modules).
const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMain) {
  seedThickAgent().catch((e) => {
    console.error('seed-thick-agent failed:', e);
    process.exit(1);
  });
}
