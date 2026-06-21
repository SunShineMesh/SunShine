// XRPL client singleton + a submit() helper that autofills, signs, submits,
// and throws on any non-tesSUCCESS result. Pattern validated in spike/spike.mjs.
import { Client, type Wallet } from 'xrpl';
import { CONFIG } from '../config.js';

let client: Client | null = null;

export async function getClient(): Promise<Client> {
  if (client && client.isConnected()) return client;
  client = new Client(CONFIG.network);
  await client.connect();
  return client;
}

export async function closeClient(): Promise<void> {
  if (client && client.isConnected()) await client.disconnect();
  client = null;
}

export interface SubmitResult { hash: string; result: any; }

export async function submit(c: Client, wallet: Wallet, tx: any, label: string): Promise<SubmitResult> {
  const prepared = await c.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await c.submitAndWait(signed.tx_blob);
  const code = (res.result.meta as any)?.TransactionResult;
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`);
  return { hash: res.result.hash as string, result: res.result };
}
