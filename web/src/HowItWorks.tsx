import { useEffect, type CSSProperties, type ReactNode } from 'react';

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const SECTION: CSSProperties = { scrollMarginTop: 120 };

// ── the signature: a sequence diagram where every arrow is a real XRPL tx ──
const LANES = [
  { id: 'agent', label: 'AI Agent', sub: 'holds its own key' },
  { id: 'mesh', label: 'MeshCredit', sub: 'bureau · issuer' },
  { id: 'bank', label: 'Bank', sub: 'owns the gate' },
] as const;
const LANE_X: Record<string, number> = { agent: 120, mesh: 380, bank: 640 };
const tone = (t: string) =>
  t === 'credit' ? 'var(--credit)' : t === 'danger' ? 'var(--danger)' : t === 'muted' ? 'var(--muted)' : 'var(--mesh-1)';

type Step =
  | { kind: 'self'; lane: string; n: string; label: string; sub: string; t: string; dashed?: boolean; y: number }
  | { kind: 'arrow'; from: string; to: string; n: string; label: string; sub: string; t: string; y: number };

const STEPS: Step[] = [
  { kind: 'self', lane: 'mesh', n: '1', label: 'KYA underwrite', sub: 'off-chain + on-chain signals → trust score / tier', t: 'muted', dashed: true, y: 96 },
  { kind: 'arrow', from: 'mesh', to: 'agent', n: '2', label: 'CredentialCreate', sub: 'XLS-70 · issues the AgentTrustCredential', t: 'mesh', y: 156 },
  { kind: 'self', lane: 'agent', n: '3', label: 'CredentialAccept', sub: 'agent signs · sets lsfAccepted', t: 'mesh', y: 216 },
  { kind: 'self', lane: 'bank', n: '4', label: 'DepositPreauth', sub: 'bank gates its account on the MeshCredit credential', t: 'muted', dashed: true, y: 288 },
  { kind: 'arrow', from: 'agent', to: 'bank', n: '5', label: 'EscrowCreate', sub: 'funds held at the bank, awaiting approval', t: 'mesh', y: 360 },
  { kind: 'arrow', from: 'agent', to: 'bank', n: '6', label: 'EscrowFinish + CredentialIDs', sub: 'certified → released straight-through', t: 'credit', y: 432 },
  { kind: 'arrow', from: 'mesh', to: 'agent', n: '7', label: 'CredentialDelete', sub: 'kill-switch → denied everywhere; in-flight refunds to sender', t: 'danger', y: 504 },
];

function SeqDiagram() {
  return (
    <svg className="seq" viewBox="0 0 760 560" role="img" aria-label="MeshCredit lifecycle sequence diagram — every arrow is a validated XRPL transaction">
      <defs>
        {['mesh', 'credit', 'danger', 'muted'].map((t) => (
          <marker key={t} id={`ah-${t}`} markerWidth="10" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,3 L0,6 Z" fill={tone(t)} />
          </marker>
        ))}
      </defs>

      {/* lifelines */}
      {LANES.map((l) => (
        <line key={l.id} x1={LANE_X[l.id]} y1={56} x2={LANE_X[l.id]} y2={540} stroke="var(--line)" strokeWidth="1.5" strokeDasharray="3 6" />
      ))}

      {/* actor headers */}
      {LANES.map((l) => (
        <g key={l.id}>
          <rect x={LANE_X[l.id] - 72} y={8} width={144} height={40} rx={10} fill="var(--surface-2)" stroke="var(--line)" />
          <text x={LANE_X[l.id]} y={26} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="600">{l.label}</text>
          <text x={LANE_X[l.id]} y={40} textAnchor="middle" fill="var(--muted)" fontSize="9.5">{l.sub}</text>
        </g>
      ))}

      {/* steps */}
      {STEPS.map((s) => {
        const c = tone(s.t);
        const num = (
          <>
            <circle cx={26} cy={s.y} r={11} fill="var(--ledger)" stroke={c} strokeWidth="1.5" />
            <text x={26} y={s.y + 3.5} textAnchor="middle" fill={c} fontSize="11" fontWeight="700">{s.n}</text>
          </>
        );
        if (s.kind === 'self') {
          const x = LANE_X[s.lane];
          const w = Math.max(150, s.label.length * 7 + 28);
          return (
            <g key={s.n}>
              {num}
              <rect x={x - w / 2} y={s.y - 15} width={w} height={30} rx={8} fill="var(--surface)" stroke={c} strokeWidth="1.3" strokeDasharray={s.dashed ? '4 4' : undefined} />
              <text x={x} y={s.y} textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontSize="12" fontWeight="600">{s.label}</text>
              <text x={x} y={s.y + 28} textAnchor="middle" fill="var(--muted)" fontSize="10.5">{s.sub}</text>
            </g>
          );
        }
        const x1 = LANE_X[s.from], x2 = LANE_X[s.to];
        const dir = x2 > x1 ? 1 : -1;
        const mid = (x1 + x2) / 2;
        return (
          <g key={s.n}>
            {num}
            <text x={mid} y={s.y - 10} textAnchor="middle" fill="var(--ink)" fontSize="12" fontWeight="600">{s.label}</text>
            <line x1={x1 + dir * 6} y1={s.y} x2={x2 - dir * 10} y2={s.y} stroke={c} strokeWidth="2" markerEnd={`url(#ah-${s.t})`} className={s.t === 'credit' ? 'seq-accent' : undefined} />
            <text x={mid} y={s.y + 16} textAnchor="middle" fill="var(--muted)" fontSize="10.5">{s.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── data for the static diagrams ──
const ON_LEDGER = [
  ['AgentTrustCredential', 'Tier, maxTxAmount, score, expiry — readable by anyone, from any transaction.', 'XLS-70'],
  ['The bank\'s gate', 'DepositAuth + DepositPreauth → AuthorizeCredentials on the MeshCredit credential.', 'XLS-80'],
  ['Funds held at the bank', 'Escrow with CancelAfter — guarantees refund to sender if not released.', 'XLS-85'],
  ['Currency exchange', 'Cross-currency Payment over the XRPL DEX (the FX leg).', 'DEX'],
  ['Identity anchor', 'did:xrpl:1:<addr> — survives wallet / agent re-registration.', 'XLS-40'],
  ['Kill-switch', 'CredentialDelete — revoked in one ~4s ledger close; in-flight escrows refund.', 'XLS-70'],
];
const OFF_LEDGER = [
  ['KYA inputs', 'Traces, transcripts, World ID — only a content-hash goes on-chain.', 'private'],
  ['Underwriting engine', '100-point scorecard → tier + maxTxAmount.', 'scorecard'],
  ['Payment-request matching', 'Status: pending_bank / approved / released / refunded.', 'JSON store'],
  ['Treasury keys & float', 'Issues credentials, funds demo wallets, runs the bureau.', 'server'],
  ['The credential graph', 'Every honored credential compounds the data moat over time.', 'data'],
];

const KYA = [
  { c: '#5b8cff', lbl: 'World ID — the human behind the agent', pts: 15, src: 'off-chain' },
  { c: '#6f9bff', lbl: 'Runtime / model stability', pts: 10, src: 'off-chain' },
  { c: '#83aaff', lbl: 'Transcript coherence', pts: 10, src: 'off-chain' },
  { c: '#9abaff', lbl: 'Source snapshot provided', pts: 5, src: 'off-chain' },
  { c: '#b3ccff', lbl: 'Human owner DID complete', pts: 5, src: 'off-chain' },
  { c: '#8b5cf6', lbl: 'KYB-verified operator backing', pts: 10, src: 'KYB' },
  { c: '#4ade9e', lbl: 'XRPL account age (full at ≥30 days)', pts: 10, src: 'on-chain' },
  { c: '#3ccf8f', lbl: 'Prior settlement payments (1 pt each)', pts: 15, src: 'on-chain' },
  { c: '#32c084', lbl: 'Escrow completion rate', pts: 15, src: 'on-chain' },
  { c: '#28b178', lbl: 'Prior payment success rate', pts: 15, src: 'on-chain' },
];
const KYA_MAX = KYA.reduce((a, k) => a + k.pts, 0); // 110 of weight, score capped at 100

const TIERS = [
  { score: '0 – 29', name: 'DENIED', lim: '—', col: 'var(--faint)', denied: true },
  { score: '30 – 49', name: 'TIER-1', lim: '$25', col: '#f5b84b' },
  { score: '50 – 69', name: 'TIER-2', lim: '$100', col: '#5b8cff' },
  { score: '70 – 84', name: 'TIER-3', lim: '$500', col: '#8b5cf6' },
  { score: '85 – 100', name: 'TIER-4', lim: '$2000', col: '#4ade9e' },
];

const ESCROW = [
  ['RLUSD in', 'Funds arrive as RLUSD; the XRPL DEX converts the currency for the target corridor.', 'DEX payment'],
  ['EscrowCreate', 'The agent locks the payment amount at the bank\'s gated account (CancelAfter set).', 'XLS-85'],
  ['Bank approval', 'Bank reviews the pending payment request and approves or rejects.', 'off-ledger'],
  ['EscrowFinish + CredentialIDs', 'Agent presents its trust credential\'s ledger-entry index — the bank gate enforces on-ledger.', 'CredentialIDs'],
  ['Release or refund', 'Certified: funds flow to Bob (tesSUCCESS). Uncertified or rejected: refund to sender.', 'tesSUCCESS / refund'],
];

const GOOD = [
  ['XLS-40 DID', 'agent identity anchor', 'live'],
  ['XLS-70 Credentials', 'the trust credential + kill-switch', 'live'],
  ['XLS-80 DepositPreauth', 'the bank\'s gate (AuthorizeCredentials)', 'live'],
  ['XLS-85 Token Escrow', 'funds held at the bank; CancelAfter refund', 'live'],
  ['DEX cross-currency Payment', 'the FX leg', 'live'],
  ['RLUSD', 'settlement asset (XRP on testnet demo)', 'live'],
];
const AVOID = [
  ['XLS-66 Lending', 'native pools', 'devnet'],
  ['XLS-65 Vaults', 'pooled liquidity', 'devnet'],
  ['XLS-56 Batch', 'atomic FX + escrow', 'disabled'],
  ['XLS-75 Delegation', 'permissioned signing', 'disabled'],
  ['XLS-100 WASM', 'smart escrow', 'not mainnet'],
];

const FLY = [
  ['Trust bureau', 'Issue the portable on-ledger credential — the entry ticket to gated rails.'],
  ['Bureau read API', 'Any bank / PSP reads standing at tx time — per-verification revenue, zero capital.'],
  ['Kill-switch / gate SLA', 'Enterprise revocation SLA: revoke once, denied everywhere; in-flight escrows refund.'],
  ['Skills economy', 'The same credential rail attests agent skills (agent_skill_v1) — a credentialed agent labour market.'],
  ['Cross-stablecoin settlement', 'RLUSD-native, asset-agnostic credential — one issuer flag from mainnet escrow.'],
];

const HTTP_API: [string, string, string][] = [
  ['GET', '/api/health', 'Network, settlement asset, and the treasury (bureau) & bank (gate) addresses.'],
  ['POST', '/api/agent/create', 'Fund a managed agent wallet. Returns address + DID.'],
  ['POST', '/api/kya/evaluate', 'Run KYA on { agentAddr, offChain } and return the decision — no state change.'],
  ['POST', '/api/payment/initiate', 'Certify (if needed) → gate-check (incl. amount) → escrow funds at the bank\'s gate. Body { agentAddr, recipientAddr, amount }. Returns { payment, credId, gate }.'],
  ['POST', '/api/payment/approve', 'Release into the gated account (needs the credential). Body { id }. Returns { finishHash, payment }.'],
  ['POST', '/api/payment/reject', 'Cancel the escrow → refund to the sender. Body { id }.'],
  ['GET', '/api/payments', 'All payment requests.'],
  ['POST', '/api/skill/certify', 'Issue an agent_skill_v1 credential. Body { agentAddr, skillId }.'],
  ['GET', '/api/skill/:addr', "Read an agent's skill credential."],
  ['POST', '/api/killswitch', 'Revoke the trust credential for { agentAddr } — denied everywhere at once.'],
  ['GET', '/api/credential/:addr', "Public bureau read of any agent's trust credential — no account, no API key."],
  ['GET', '/api/domain/gate/:addr', 'Read-only gate check (tier + maxTxAmount). Query: ?tier=&amount='],
  ['GET', '/api/events', 'Server-sent events: a live stream of on-chain transactions.'],
];

const SDK_API: [string, string][] = [
  ['new MeshCredit({ serverUrl })', 'Point the client at a MeshCredit treasury endpoint.'],
  ['await mc.register()', 'KYA → on-ledger trust credential. Returns { address, did }.'],
  ["await mc.payment.initiate(recipientAddr, '50')", "Funds held at the bank's gate. Returns { payment }."],
  ['await mc.payment.approve(payment.id)', 'Certified → released through the bank.'],
  ['await mc.payment.reject(payment.id)', 'Refund to the sender.'],
  ["await mc.skill.certify('pdf-extract')", 'Attest a specialized skill (UC2).'],
  ['await mc.credential(addr?)', "Read any agent's on-ledger trust credential (the public bureau)."],
];

const MODULES: [string, [string, string][]][] = [
  ['src/xrpl/', [
    ['codec', 'URI codec, InvoiceID, makePreimageCondition'],
    ['client', 'getClient · submit (autofill→sign→wait)'],
    ['credential', 'issue · accept · fetch · revoke (XLS-70 trust)'],
    ['domain', 'bank gate: setupDepositPreauth · gateCheck · withinLimit'],
    ['escrow', 'createPaymentEscrow · finishEscrow w/ CredentialIDs (XLS-85)'],
    ['bankGate', 'submitPaymentForApproval · approveAndRelease · rejectAndRefund'],
    ['dex', 'swapViaPathPayment · seedOfferBook'],
    ['skillCredential', 'agent_skill_v1'],
    ['operator', 'operator_v1 KYB'],
    ['stablecoin', 'RLUSD stand-in'],
  ]],
  ['src/kya/', [
    ['scorecard', 'score() · decide() — 100-pt → tier + maxTxAmount'],
    ['signals', 'readOnChainSignals() from account_tx'],
    ['underwrite', 'signals → trust terms'],
    ['kyb', 'kybScore — the business layer'],
  ]],
  ['src/treasury/', [
    ['paymentStore', 'PaymentRequest ledger'],
    ['server', 'HTTP API + SSE event feed'],
  ]],
  ['src/agent/', [
    ['sdk', 'MeshCredit client: payment / skill'],
    ['demoUC1', 'narrated bank-gate run on testnet'],
  ]],
];

const TOC = [
  ['arch', 'Architecture'], ['lifecycle', 'Lifecycle'], ['kya', 'KYA'],
  ['escrow', 'Escrow'], ['primitives', 'Primitives'], ['growth', 'Growth'], ['build', 'Build'],
];

export default function HowItWorks() {
  useEffect(() => { document.title = 'How MeshCredit works'; }, []);

  return (
    <>
      <nav className="nav"><div className="wrap nav-in">
        <a className="brand" href="#/" style={{ textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="nav-links">
          {TOC.map(([id, label]) => <button key={id} onClick={() => go(id)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 }}>{label}</button>)}
        </div>
        <a className="pill" href="#/" style={{ textDecoration: 'none' }}>← Back to the app</a>
      </div></nav>

      <header className="wrap doc-hero">
        <div className="eyebrow">How it works · the whole machine</div>
        <h1>One credential, every gated rail on the <span className="grad">XRP Ledger</span>.</h1>
        <p className="sub">
          MeshCredit is a trust bureau: it issues a portable, on-ledger XLS-70 credential for an AI agent;
          a bank configures its own account gate to require it. FICO model — MeshCredit issues the score,
          the bank keeps the decision. This page is the full picture: what lives on the ledger, the
          transaction-by-transaction lifecycle, how Know Your Agent scores an agent, how XLS-85 escrow
          holds funds at the bank, and the API you build on. Every diagram maps to code that runs on
          testnet today.
        </p>
      </header>

      <div className="wrap"><div className="toc">
        {TOC.map(([id, label]) => <button key={id} onClick={() => go(id)}>{label}</button>)}
      </div></div>

      {/* ── ARCHITECTURE ── */}
      <section className="section" id="arch" style={SECTION}><div className="wrap">
        <div className="eyebrow">The split</div>
        <h2>What's on the ledger, what's ours</h2>
        <p className="lede">The design rule is simple: anything a third party must trust lives <b style={{ color: 'var(--ink)' }}>on the XRP Ledger</b>, where they can verify it without calling us. Everything private or operational stays off-ledger. The on-chain layer is the product; the off-ledger layer is the business.</p>
        <div className="arch">
          <div className="arch-col ledger">
            <div className="arch-h"><div className="ic on">◇</div><div><h3>On the XRP Ledger</h3><div className="tag">public · verifiable · permissionless</div></div></div>
            <div style={{ marginTop: 14 }}>
              {ON_LEDGER.map(([t, d, p]) => (
                <div className="arch-row" key={t}><div className="t">{t}<span className="pin">{p}</span></div><div className="d">{d}</div></div>
              ))}
            </div>
          </div>
          <div className="arch-col off">
            <div className="arch-h"><div className="ic of">▤</div><div><h3>Off-ledger · MeshCredit</h3><div className="tag">private · operational</div></div></div>
            <div style={{ marginTop: 14 }}>
              {OFF_LEDGER.map(([t, d, p]) => (
                <div className="arch-row" key={t}><div className="t">{t}<span className="pin blue">{p}</span></div><div className="d">{d}</div></div>
              ))}
            </div>
          </div>
        </div>
        <div className="note">The boundary is the whole thesis: the trust score isn't trapped in our database — it's an XLS-70 object any bank, PSP, or permissioned domain reads straight from the ledger. MeshCredit is capital-light: it issues attestations, never holds a balance sheet or seizes funds.</div>
      </div></section>

      {/* ── LIFECYCLE ── */}
      <section className="section" id="lifecycle" style={SECTION}><div className="wrap">
        <div className="eyebrow">The lifecycle</div>
        <h2>Seven moves, every one a transaction</h2>
        <p className="lede">From underwriting an agent to the kill-switch denying it everywhere. Each arrow below is a validated XRPL transaction; the label is the transaction type and the colour is who signs it.</p>
        <div className="diagram diagram-scroll">
          <SeqDiagram />
          <div className="legend">
            <span><i style={{ background: 'var(--mesh-1)' }} />MeshCredit signs (issue · credential · revoke)</span>
            <span><i style={{ background: 'var(--credit)' }} />Agent signs (accept · EscrowFinish with CredentialIDs)</span>
            <span><i style={{ background: 'var(--danger)' }} />Kill-switch</span>
            <span><i style={{ background: 'var(--muted)' }} />Off-chain / bank-setup step</span>
          </div>
        </div>
        <div className="note">Step 6 is the hero beat: the <b style={{ color: 'var(--credit)' }}>same</b> EscrowFinish succeeds for a certified agent and returns <code>tecNO_PERMISSION</code> for an uncertified one — enforced on-ledger by the bank's DepositPreauth gate, no MeshCredit API call, no bank action required at tx time.</div>
      </div></section>

      {/* ── KYA ── */}
      <section className="section" id="kya" style={SECTION}><div className="wrap">
        <div className="eyebrow">Know Your Agent</div>
        <h2>A transparent 100-point trust score</h2>
        <p className="lede">No black box. Off-chain behaviour (45 pts), a KYB-verified operator's backing (10 pts) and the agent's actual on-chain history (55 pts) — summing to 110 of weight, with the score capped at 100. A brand-new agent has no settlement history yet, so it starts around TIER-2 on its off-chain signals plus operator backing, then climbs as real on-ledger history accrues. The score sets the tier and the <code>maxTxAmount</code> (the maximum single payment the credential permits), stamped into the on-ledger credential. KYB (<code>operator_v1</code>) scores the business entity behind the agent — Dun &amp; Bradstreet to KYA's FICO.</p>
        <div className="diagram">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Off-chain 45 &nbsp;+&nbsp; operator backing 10 &nbsp;+&nbsp; on-chain history 55 &nbsp;→&nbsp; capped at 100</div>
          <div className="score-bar">
            {KYA.map((k) => (
              <div className="score-seg" key={k.lbl} style={{ width: `${(k.pts / KYA_MAX) * 100}%`, background: k.c }} title={`${k.lbl} — ${k.pts} pts`}>{k.pts >= 10 ? k.pts : ''}</div>
            ))}
          </div>
          <div className="score-key">
            {KYA.map((k) => (
              <div className="row" key={k.lbl}><i style={{ background: k.c }} /><span className="lbl">{k.lbl}</span><span className="pts">{k.pts}</span><span className="src">{k.src}</span></div>
            ))}
          </div>
        </div>
        <h3 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 18, margin: '30px 0 0' }}>From score to max single payment</h3>
        <div className="ladder">
          {TIERS.map((t) => (
            <div className={'rung' + (t.denied ? ' denied' : '')} key={t.name} style={{ borderTopColor: t.col }}>
              <div className="rscore">{t.score}</div>
              <div className="rname" style={{ color: t.col }}>{t.name}</div>
              <div className="rlim">{t.lim}</div>
            </div>
          ))}
        </div>
      </div></section>

      {/* ── ESCROW ── */}
      <section className="section" id="escrow" style={SECTION}><div className="wrap">
        <div className="eyebrow">XLS-85 token escrow</div>
        <h2>Funds held at the bank's gated account</h2>
        <p className="lede">The agent locks the payment in escrow at the bank's gated account. The bank approves; the agent releases by presenting the <code>CredentialIDs</code> (the trust credential's ledger-entry index). On reject the escrow refunds to the sender via <code>CancelAfter</code> — MeshCredit can block delivery but never seizes funds.</p>
        <div className="diagram">
          <div className="flow">
            {ESCROW.map(([t, d, tag], i) => (
              <Frag key={t} arrow={i > 0}>
                <div className="flow-node">
                  <div className="fn-n">{i + 1}</div>
                  <div className="fn-t">{t}</div>
                  <div className="fn-d">{d}</div>
                  <div className="fn-tag pin">{tag}</div>
                </div>
              </Frag>
            ))}
          </div>
          <div className="flag-callout">
            <div className="fci">⚑</div>
            <div className="fct">
              <b>One flag from mainnet.</b> The mainnet RLUSD issuer (<code>rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De</code>) lacks <code>lsfAllowTrustLineLocking</code>,
              so RLUSD escrow isn't possible there yet. We prove it on testnet against an issuer we control with the
              flag set — the <i>same code</i> escrows real RLUSD the moment Ripple runs one
              <code> AccountSet asfAllowTrustLineLocking</code>. A blocker turned into a one-line ask.
            </div>
          </div>
        </div>
      </div></section>

      {/* ── PRIMITIVES ── */}
      <section className="section" id="primitives" style={SECTION}><div className="wrap">
        <div className="eyebrow">Mainnet-readiness</div>
        <h2>Built only on live primitives</h2>
        <p className="lede">Viability is the top judging axis, so MeshCredit depends on nothing that isn't live on XRPL mainnet today. The promoted-but-unshipped primitives are deliberately avoided — depending on them would break the "deployable now" claim.</p>
        <div className="prims">
          <div className="prim-card good">
            <h4>We build on</h4><div className="ph">live on mainnet</div>
            {GOOD.map(([n, d, s]) => (
              <div className="prim" key={n}><span className="px">{n} <small>· {d}</small></span><span className="st">● {s}</span></div>
            ))}
          </div>
          <div className="prim-card">
            <h4>We avoid</h4><div className="ph">not mainnet-ready</div>
            {AVOID.map(([n, d, s]) => (
              <div className="prim bad" key={n}><span className="px">{n} <small>· {d}</small></span><span className="st">○ {s}</span></div>
            ))}
          </div>
        </div>
        <div className="note">Phase 2: when XLS-66 lending reaches mainnet, lender-marketplace underwriting can run on native on-chain pools — the credential and bureau layer don't change.</div>
      </div></section>

      {/* ── GROWTH ── */}
      <section className="section" id="growth" style={SECTION}><div className="wrap">
        <div className="eyebrow">Why this is infrastructure</div>
        <h2>The bureau is the wedge — the graph is the company</h2>
        <p className="lede">Each stage is built on the data the previous one originates. The bureau issues credentials; credentials compound payment history; history deepens the score; the score attracts banks and PSPs; enterprise SLAs fund the kill-switch infrastructure. It compounds — capital-light all the way.</p>
        <div className="diagram">
          <div className="fly">
            {FLY.map(([t, d], i) => (
              <Frag key={t} arrow={i > 0} fl>
                <div className="fly-stage">
                  <div className="fs-n">{i + 1}</div>
                  <div className="fs-t">{t}</div>
                  <div className="fs-d">{d}</div>
                </div>
              </Frag>
            ))}
          </div>
          <div className="fly-loop">↻ &nbsp;Every honored credential compounds the credit graph — the moat a private database can't replicate. MeshCredit is capital-light: it issues attestations, never holds a balance sheet or seizes funds.</div>
        </div>
      </div></section>

      {/* ── BUILD / DOCS ── */}
      <section className="section" id="build" style={SECTION}><div className="wrap">
        <div className="eyebrow">Build on MeshCredit</div>
        <h2>The developer surface</h2>
        <p className="lede">Give an agent a trust credential and gate a bank account in a few lines, or read any agent's standing straight from the ledger. The treasury exposes a small HTTP API; the SDK wraps it.</p>

        <div className="doc-block">
          <h3>SDK</h3>
          <p className="dh">In production the agent holds its own key and signs accept / EscrowFinish client-side.</p>
          <pre className="code"><span className="k">import</span> {'{ MeshCredit }'} <span className="k">from</span> <span className="s">'meshcredit'</span>;{'\n\n'}
<span className="k">const</span> mc = <span className="k">new</span> MeshCredit();              <span className="c">// your treasury endpoint</span>{'\n'}
<span className="k">await</span> mc.register();                  <span className="c">// KYA → on-ledger trust credential</span>{'\n'}
<span className="k">const</span> {'{ payment }'} = <span className="k">await</span> mc.payment.initiate(bob, <span className="s">'50'</span>); <span className="c">// funds held at the bank's gate</span>{'\n'}
<span className="k">await</span> mc.payment.approve(payment.id); <span className="c">// certified → released through the bank</span>{'\n'}
<span className="k">await</span> mc.skill.certify(<span className="s">'pdf-extract'</span>); <span className="c">// attest a specialized skill (UC2)</span></pre>
          <div className="api-list" style={{ marginTop: 16 }}>
            {SDK_API.map(([sig, d]) => (
              <div className="api" key={sig}><span className="verb sdk">SDK</span><div><div className="ep">{sig}</div><div className="ed">{d}</div></div></div>
            ))}
          </div>
        </div>

        <div className="doc-block">
          <h3>HTTP API</h3>
          <p className="dh">Everything the console calls. CORS-open; no auth on the public bureau read.</p>
          <div className="api-list">
            {HTTP_API.map(([verb, ep, d]) => (
              <div className="api" key={ep}><span className={'verb ' + verb.toLowerCase()}>{verb}</span><div><div className="ep">{ep}</div><div className="ed">{d}</div></div></div>
            ))}
          </div>
        </div>

        <div className="doc-block">
          <h3>The on-ledger credential</h3>
          <p className="dh">The XLS-70 URI is capped at 256 hex chars (128 bytes), so it carries a compact summary; the full KYA dossier lives off-ledger behind the content-hash <code style={{ fontFamily: 'var(--mono)', color: 'var(--credit)' }}>ref</code>. The <code>CredentialIDs</code> field on EscrowFinish is the credential's <b>ledger-entry index</b> (from <code>ledger_entry</code>, returned as <code>credId</code>) — NOT the CredentialType hex. This is what the bank's DepositAuth gate enforces.</p>
          <pre className="code"><span className="c">// CredentialType = hex("agent_trust_v1")</span>{'\n'}
<span className="c">//   = 6167656E745F74727573745F7631</span>{'\n'}
<span className="c">// URI (≤256 hex chars, decoded):</span>{'\n'}
{'{'} <span className="s">"v"</span>: 1, <span className="s">"tier"</span>: <span className="s">"TIER-2"</span>, <span className="s">"maxTxAmount"</span>: <span className="s">"100"</span>,{'\n'}
{'  '}<span className="s">"score"</span>: 70, <span className="s">"exp"</span>: 802101600, <span className="s">"ref"</span>: <span className="s">"23C9FE5AA800785C"</span> {'}'}</pre>
        </div>

        <div className="doc-block">
          <h3>Module map</h3>
          <p className="dh">Pure logic (codec, scorecard, paymentStore) is unit-tested; on-chain I/O is verified live on testnet.</p>
          <div className="modmap">
            {MODULES.map(([dir, fns]) => (
              <div className="modcard" key={dir}>
                <div className="mc-h">{dir}</div>
                {fns.map(([n, d]) => (
                  <div className="mc-fn" key={n}><code>{n}</code> · {d}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div></section>

      <footer><div className="wrap">
        <a className="brand" href="#/" style={{ marginBottom: 10, textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="mono">Built on the XRP Ledger · XLS-40 DID · XLS-70 Credentials · XLS-80 DepositPreauth · XLS-85 Escrow · DEX · RLUSD</div>
        <div style={{ marginTop: 8 }}>Every diagram on this page maps to code verified on XRPL testnet. <a href="#/" style={{ color: 'var(--mesh-1)' }}>← Back to the live console</a></div>
      </div></footer>
    </>
  );
}

// tiny helper: optionally prefix a node with a connector arrow
function Frag({ children, arrow, fl }: { children: ReactNode; arrow: boolean; fl?: boolean }) {
  return (
    <>
      {arrow && <div className={fl ? 'fly-arrow' : 'flow-arrow'}>→</div>}
      {children}
    </>
  );
}
