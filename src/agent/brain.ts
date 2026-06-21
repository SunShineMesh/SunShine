// MeshCredit agent brain — REAL LLM reasoning via DeepSeek (OpenAI-compatible).
//
// This is what makes the demo agent's behaviour genuine rather than scripted: at
// each judgement point the agent actually calls a frontier model, and the model's
// decision changes what the agent does on-ledger (a HOLD verdict makes the agent
// refund instead of release). DeepSeek's reasoning models return the chain of
// thought separately (`reasoning_content`) from the final answer (`content`), so
// the UI can show the agent literally thinking out loud and then deciding.
//
// No API key → a clearly-labelled fallback (never a silently faked thought).
import { CONFIG } from '../config.js';

export function brainEnabled(): boolean {
  return !!CONFIG.deepseek.apiKey;
}

export interface Thought {
  content: string;     // the agent's final answer
  reasoning: string;   // the agent's chain of thought (reasoning_content)
  ms: number;          // wall-clock latency of the real call
  model: string;
  fallback: boolean;   // true iff this was NOT a live model call
}

/** One real reasoning call. Defaults to the fast model; pass a model for the slow/deep one. */
export async function reason(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<Thought> {
  const model = opts.model ?? CONFIG.deepseek.flashModel;
  const t0 = Date.now();
  if (!brainEnabled()) {
    return { content: '(agent LLM disabled — set DEEPSEEK_API_KEY in .env)', reasoning: '', ms: 0, model, fallback: true };
  }
  try {
    const r = await fetch(CONFIG.deepseek.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CONFIG.deepseek.apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: opts.maxTokens ?? CONFIG.deepseek.maxTokens,
        temperature: opts.temperature ?? 0.3,
      }),
    });
    const j: any = await r.json();
    if (!r.ok || j.error) {
      return { content: `(agent LLM error ${r.status}: ${j?.error?.message ?? 'unknown'})`, reasoning: '', ms: Date.now() - t0, model, fallback: true };
    }
    const m = j.choices?.[0]?.message ?? {};
    return {
      content: String(m.content ?? '').trim(),
      reasoning: String(m.reasoning_content ?? '').trim(),
      ms: Date.now() - t0,
      model,
      fallback: false,
    };
  } catch (e: any) {
    return { content: `(agent LLM error: ${e?.message ?? e})`, reasoning: '', ms: Date.now() - t0, model, fallback: true };
  }
}

export interface PaymentAssessment {
  decision: 'PROCEED' | 'HOLD';
  rationale: string;
  reasoning: string;
  ms: number;
  model: string;
  fallback: boolean;
}

export interface CounterpartyAssessment {
  decision: 'PROCEED' | 'HOLD';
  rationale: string;
  reasoning: string;
  ms: number;
  model: string;
  fallback: boolean;
}

/**
 * The agent reasons about a flagged counterparty (e.g. sanctions-screen result).
 * Used as an extra layer BEFORE the deterministic D6 gate — the model itself
 * recognises the risk and returns HOLD so the step log shows genuine reasoning.
 */
export async function assessCounterparty(ctx: {
  counterpartyName: string;
  amlAction: 'DENY' | 'REVIEW' | 'PASS';
  amlScore: number;
  matchedName: string;
  tier: string;
  maxTxAmount: string;
}): Promise<CounterpartyAssessment> {
  const system =
    `You are Aria, an autonomous procurement AI agent. You have just received a sanctions ` +
    `screening result for a proposed payment counterparty. Your compliance mandate requires you ` +
    `to refuse any payment to a counterparty that is flagged by OFAC SDN screening. ` +
    `Answer in this exact shape: first line "DECISION: PROCEED" or "DECISION: HOLD"; ` +
    `second line one short sentence of rationale.`;
  const user =
    `Counterparty sanctions screening result:\n` +
    `- Proposed counterparty: ${ctx.counterpartyName}\n` +
    `- AML screening action: ${ctx.amlAction}\n` +
    `- Confidence score: ${ctx.amlScore.toFixed(3)}\n` +
    `- Matched SDN name: ${ctx.matchedName}\n` +
    `- Your tier: ${ctx.tier}, ceiling: $${ctx.maxTxAmount}\n\n` +
    `Given this result, assess whether to proceed with or hold the payment.`;
  const t = await reason(system, user, { model: CONFIG.deepseek.flashModel, maxTokens: CONFIG.deepseek.maxTokens });
  const decision: 'PROCEED' | 'HOLD' = /DECISION:\s*HOLD/i.test(t.content) ? 'HOLD' : 'PROCEED';
  const rationale =
    t.content.replace(/^.*DECISION:\s*(PROCEED|HOLD)\s*/is, '').replace(/^[\s\-—:.]+/, '').trim()
    || t.content.trim()
    || (t.fallback ? 'LLM unavailable — HOLD on sanctions hit.' : '');
  return { decision, rationale, reasoning: t.reasoning, ms: t.ms, model: t.model, fallback: t.fallback };
}

/** The agent's real AML/policy risk decision on a specific cross-border payment.
 *  A HOLD verdict makes the agent refund the escrow instead of releasing it. */
export async function assessPayment(ctx: {
  payer: string; payerCountry: string;
  payee: string; payeeCountry: string;
  amount: string; currency: string; purpose: string;
  tier: string; maxTxAmount: string;
  amlAction?: 'DENY' | 'REVIEW' | 'PASS';
}): Promise<PaymentAssessment> {
  const system =
    `You are Aria, an autonomous procurement AI agent acting for a KYB-verified company. ` +
    `You hold an on-ledger MeshCredit trust credential: ${ctx.tier}, with a hard ceiling of ` +
    `$${ctx.maxTxAmount} per single payment. A deterministic OFAC/SDN sanctions screen runs ` +
    `separately and will hard-block any sanctioned counterparty at the ledger gate; treat its ` +
    `result as one input, but still apply your own judgement on fraud, scope, and your ceiling. ` +
    `Before moving any money you must assess the payment for AML / fraud / sanctions risk and ` +
    `confirm it is within your credential's ceiling. ` +
    `Approve only when the payment is in-policy and shows no red flags. ` +
    `Answer in this exact shape: first line "DECISION: PROCEED" or "DECISION: HOLD"; ` +
    `second line one short sentence of rationale (no preamble).`;
  // Surface the already-computed deterministic screen result so the agent reasons
  // WITH it rather than blind to it. A clean PASS on a legitimate counterparty
  // should not, on its own, become a spurious HOLD.
  const screenLine = ctx.amlAction
    ? `- OFAC/SDN sanctions screen (already run on this counterparty): ${ctx.amlAction}\n`
    : '';
  const user =
    `Cross-border payment request:\n` +
    `- Payer: ${ctx.payer} (${ctx.payerCountry})\n` +
    `- Payee: ${ctx.payee} (${ctx.payeeCountry})\n` +
    `- Amount: ${ctx.amount} ${ctx.currency}\n` +
    `- Purpose: ${ctx.purpose}\n` +
    screenLine +
    `- Your credential ceiling: $${ctx.maxTxAmount} (${ctx.tier})\n\n` +
    `Assess the risk and decide.`;
  const t = await reason(system, user, { model: CONFIG.deepseek.model, maxTokens: CONFIG.deepseek.maxTokens });
  const decision: 'PROCEED' | 'HOLD' = t.fallback || /DECISION:\s*HOLD/i.test(t.content) ? 'HOLD' : 'PROCEED';
  const rationale =
    t.content.replace(/^.*DECISION:\s*(PROCEED|HOLD)\s*/is, '').replace(/^[\s\-—:.]+/, '').trim()
    || t.content.trim()
    || (t.fallback ? 'LLM unavailable — holding payment (fail-safe).' : '');
  return { decision, rationale, reasoning: t.reasoning, ms: t.ms, model: t.model, fallback: t.fallback };
}
