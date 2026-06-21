// The Live Demo Theater — watch Aria pay across borders, step by step, live on
// XRPL testnet. Every transaction is real; the agent's risk decision is a real
// DeepSeek call. The whole arc streams in over SSE from /api/demo/run.
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribe, runDemo, type DemoStep, type DimensionRecord } from './api';
import { Passport, type PassportData } from './Passport';
import { WorldIdBadge } from './WorldIdBadge';

// Default cast (the server re-sends this on demo_start); lets the corridor render before a run.
// Updated for the v2 scenario: Novartis AG with agentA (Aria) + agentB + supplierA + supplierB.
const CAST = {
  operator:  { name: 'Novartis AG', sub: 'Basel · Switzerland', flag: '🇨🇭', key: 'operator' },
  agentA:    { name: 'Aria', sub: 'procurement agent', flag: '🤖', key: 'agentA' },
  agentB:    { name: 'Bravo', sub: 'logistics agent', flag: '🤖', key: 'agentB' },
  bureau:    { name: 'MeshCredit', sub: 'trust bureau · issuer', flag: '◇', key: 'bureau' },
  bank:      { name: 'Settlement Bank', sub: 'gates its account', flag: '🏦', key: 'bank' },
  supplierA: { name: 'Lagos Precision Parts', sub: 'Lagos · Nigeria', flag: '🇳🇬', key: 'supplierA' },
  supplierB: { name: 'Taipei Tech Components', sub: 'Taipei · Taiwan', flag: '🇹🇼', key: 'supplierB' },
  // Legacy key aliases so old step events that emit 'agent'/'payee' still light up correctly
  agent: { name: 'Aria', sub: 'procurement agent', flag: '🤖', key: 'agentA' },
  payee: { name: 'Lagos Precision Parts', sub: 'Lagos · Nigeria', flag: '🇳🇬', key: 'supplierA' },
};
const STATIONS = [CAST.operator, CAST.agentA, CAST.bureau, CAST.bank, CAST.supplierA];

// Which actors each step lights up on the corridor.
// v2 step IDs follow the new scenario arc; v1 IDs kept for backward compat.
const ACTORS: Record<string, string[]> = {
  // v3 case-based arc
  setup:          ['operator', 'agentA', 'agentB', 'bureau', 'bank', 'supplierA', 'supplierB'],
  kyb:            ['operator', 'bureau'],
  gate:           ['bank'],
  kya_fresh:      ['agentA', 'bureau'],
  kya_thick:      ['agentA', 'bureau'],
  mandate:        ['operator', 'agentA'],
  caseA:          ['agentA', 'supplierA'],
  reason:         ['agentA', 'supplierA'],
  settle_a:       ['agentA', 'bank', 'supplierA'],
  caseB:          ['agentB', 'supplierB'],
  settle_b:       ['agentB', 'bank', 'supplierB'],
  caseC:          ['agentA', 'bureau'],
  denial_aml:     ['agentA', 'bureau'],
  caseD:          ['agentA', 'bureau'],
  denial_tier:    ['agentA', 'bureau'],
  caseE:          ['agentB', 'bureau'],
  denial_budget:  ['agentB', 'bureau'],
  caseGov:        ['bureau'],
  contrast:       ['bank'],
  codeswap:       ['agentA', 'bureau'],
  kill:           ['bureau', 'agentA'],
  confirm_a:      ['agentA', 'bank', 'supplierA'],
  // v1 legacy IDs (pre-v2 scenario)
  kya:            ['agentA', 'bureau'],
  fx:             ['agentA'],
  escrow:         ['agentA', 'bank'],
  gatecheck:      ['bank'],
  release:        ['agentA', 'bank', 'supplierA'],
  skill:          ['agentA', 'bureau'],
};
const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', identity: 'Identity', reasoning: 'Agent reasoning',
  payment: 'Cross-border payment', denial: 'Denied · halted', case: 'Payment case',
  contrast: 'Enforcement', governance: 'Governance', error: 'Error',
};

// Reveal a string progressively — the "watch it think" effect.
function useTypewriter(text: string, speed = 9): string {
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); }, [text]);
  useEffect(() => {
    if (!text || n >= text.length) return;
    const step = Math.max(1, Math.round(text.length / 220)); // finish in ~220 ticks max
    const id = setTimeout(() => setN((x) => Math.min(text.length, x + step)), speed);
    return () => clearTimeout(id);
  }, [text, n, speed]);
  return text.slice(0, n);
}

export default function Live() {
  const [steps, setSteps] = useState<Map<string, DemoStep>>(new Map());
  const [running, setRunning] = useState(false);
  const [brain, setBrain] = useState<string>('deepseek-v4-pro');
  const [summary, setSummary] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { document.title = 'MeshCredit — live cross-border demo'; }, []);

  useEffect(() => subscribe((e: any) => {
    if (e.type === 'demo_accepted') { setSteps(new Map()); setSummary(null); setErr(null); setRunning(true); }
    else if (e.type === 'demo_start') { setSteps(new Map()); setSummary(null); setErr(null); setRunning(true); if (e.brain) setBrain(e.brain); }
    else if (e.type === 'step') {
      setSteps((prev) => {
        const next = new Map(prev);
        const cur = next.get(e.id) ?? { id: e.id, seq: e.seq ?? next.size };
        next.set(e.id, { ...cur, ...e, data: { ...(cur as any).data, ...(e.data ?? {}) } } as DemoStep);
        return next;
      });
    } else if (e.type === 'demo_done') { setRunning(false); setSummary(e); if (e.error) setErr(e.error); }
  }), []);

  const stepsArr = useMemo(() => [...steps.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [steps]);
  const activeStep = useMemo(() => [...stepsArr].reverse().find((s) => s.status === 'active') ?? stepsArr[stepsArr.length - 1], [stepsArr]);
  const liveActors = new Set(activeStep ? ACTORS[activeStep.id] ?? [] : []);

  // v2 scenario uses 'kya_fresh' as the primary KYA step; fall back to v1 'kya' for compat.
  const kya = steps.get('kya_fresh') ?? steps.get('kya');
  const kill = steps.get('kill');
  // The agent-mind panel follows the most recent decision that carries
  // chain-of-thought, so it tracks whichever case is currently reasoning.
  const mindStep = useMemo(() => {
    const withCoT = stepsArr.filter((s) => typeof (s.data as any)?.reasoning === 'string' && (s.data as any).reasoning.length > 0);
    return withCoT[withCoT.length - 1];
  }, [stepsArr]);
  // Only mark the passport revoked if the kill-switch targeted THIS agent (Aria), not the
  // separate compromised agent. The kill step emits revokedAgent; compare to kya's agent field.
  const kyaAgent = (kya?.data as any)?.agent as string | undefined;
  const revokedAgent = (kill?.data as any)?.revokedAgent as string | undefined;
  const isPassportRevoked = !!(kill?.tx && kyaAgent && revokedAgent && revokedAgent === kyaAgent);
  const passport: PassportData | null = kya?.data ? { ...(kya.data as any), revoked: isPassportRevoked } : null;
  const txs = stepsArr.filter((s) => s.tx).map((s) => ({ ...s.tx!, id: s.id }));

  // Extract the D2 dimension from any step that carries dimensions (e.g. kya_fresh).
  const d2Dimension = useMemo<DimensionRecord | undefined>(() => {
    for (const step of stepsArr) {
      const dims = (step.data as any)?.dimensions as DimensionRecord[] | undefined;
      if (dims) {
        const d2 = dims.find((d) => d.id === 'D2');
        if (d2) return d2;
      }
    }
    return undefined;
  }, [stepsArr]);
  // Flywheel contrast: fresh agent (kya_fresh) vs thick-file agent (kya_thick).
  const kyaFresh = steps.get('kya_fresh');
  const kyaThick = steps.get('kya_thick');

  const start = async () => { setErr(null); const r = await runDemo(); if (r?.error) { setErr(r.error); setRunning(false); } };

  return (
    <>
      <nav className="nav"><div className="wrap nav-in">
        <a className="brand" href="#/" style={{ textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="nav-links">
          <a href="#/">Home</a><a href="#/how-it-works">How it works ↗</a>
        </div>
        <span className="pill"><span className="live" />{running ? 'running · XRPL testnet' : 'XRPL testnet · live'}</span>
      </div></nav>

      <header className="wrap live-hero">
        <div className="eyebrow">Live demo · everything below is a real testnet transaction</div>
        <h1>Watch <span className="grad">Aria</span> pay across borders.</h1>
        <p className="sub">
          A Swiss company's AI agent evaluates payments one counterparty at a time. Each <b>case</b> runs the
          full trust loop — and a denial <b>halts that case</b>: it pays a supplier in Lagos, then halts on a
          sanctioned counterparty, an over-ceiling amount, and an over-budget request. The agent reasons with a
          real LLM at every step, and the bank's account is gated on an on-ledger MeshCredit credential.
        </p>
        <div className="live-cta">
          <button className="btn btn-primary" onClick={start} disabled={running}>{running ? 'Running the arc…' : '▶  Run the live cross-border demo'}</button>
          <span className="live-meta">agent brain: <b>{brain}</b> · settlement on testnet</span>
        </div>
      </header>

      {/* The corridor — the signature journey strip */}
      <div className="wrap"><div className="corridor">
        {STATIONS.map((s, i) => (
          <div className="corr-cell" key={s.key}>
            <div className={'station' + (liveActors.has(s.key) ? ' on' : '') + (running ? '' : ' idle')}>
              <div className="st-flag">{s.flag}</div>
              <div className="st-name">{s.name}</div>
              <div className="st-sub">{s.sub}</div>
            </div>
            {i < STATIONS.length - 1 && <div className={'corr-link' + (running ? ' flowing' : '')} aria-hidden><span /></div>}
          </div>
        ))}
      </div></div>

      {summary && (
        <div className="wrap"><div className={'verdict ' + (summary.ok ? 'pass' : 'fail')}>
          {summary.ok
            ? <>✓ <b>{(summary.summary?.approvedCases?.length ?? 2)} settled, {(summary.summary?.deniedCases?.length ?? 3)} halted.</b> {CAST.agentA.name} ({summary.summary?.tier ?? summary.summary?.tier_v3}) settled across borders; every denied case stopped at its gate — no funds moved.</>
            : <>✕ Run ended early{err ? `: ${err}` : ''}.</>}
        </div></div>
      )}

      <main className="wrap live-grid">
        {/* Data flywheel — fresh BRONZE vs thick-file GOLD: spans both columns */}
        {(kyaFresh ?? kyaThick) && (
          <div className="live-flywheel-row">
            <div className="live-section-lbl">Data flywheel — trust compounds with history</div>
            <FlywheelContrast fresh={kyaFresh} thick={kyaThick} />
          </div>
        )}

        {/* left — the step timeline */}
        <section className="timeline" ref={timelineRef}>
          {stepsArr.length === 0 && (
            <div className="tl-empty">
              <div className="tl-empty-d">▶</div>
              Press <b>Run the live cross-border demo</b> — each step appears here as it lands on the ledger.
            </div>
          )}
          {stepsArr.map((s) => <StepCard key={s.id} s={s} />)}
        </section>

        {/* right — the agent mind + the trust passport */}
        <aside className="rail">
          <MindPanel step={mindStep} activeStep={activeStep} running={running} brain={brain} />
          {passport ? <Passport d={passport} /> : <Passport d={{}} pending />}
          {/* D2 World ID badge — shown in the right rail when a D2 dimension record is present */}
          {d2Dimension && (
            <WorldIdBadge
              proofPending={d2Dimension.status !== 'PASS'}
              nullifier={d2Dimension.status === 'PASS' ? d2Dimension.evidenceRef : undefined}
              verificationLevel={
                (d2Dimension.details?.verificationLevel as 'orb' | 'device' | undefined) ?? 'device'
              }
            />
          )}
          {txs.length > 0 && (
            <div className="tape">
              <div className="tape-h">On-ledger transactions <span>{txs.length}</span></div>
              {txs.map((t, i) => (
                <a className="tape-row" key={t.id + i} href={t.url} target="_blank" rel="noreferrer">
                  <span className="tape-kind">{t.kind}</span>
                  <span className="tape-lbl">{t.label}</span>
                  <span className="tape-arr">↗</span>
                </a>
              ))}
            </div>
          )}
        </aside>
      </main>

      <footer><div className="wrap">
        <a className="brand" href="#/" style={{ marginBottom: 10, textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="mono">XLS-40 DID · XLS-70 Credentials · XLS-80 DepositPreauth · XLS-85 Escrow · DEX · real DeepSeek agent reasoning</div>
        <div style={{ marginTop: 8 }}>Every transaction shown is validated on XRPL testnet. <a href="#/" style={{ color: 'var(--mesh-1)' }}>← Back to the console</a></div>
      </div></footer>
    </>
  );
}

// ── flywheel contrast: a fresh BRONZE vs thick-file GOLD agent ──
function FlywheelContrast({ fresh, thick }: { fresh?: DemoStep; thick?: DemoStep }) {
  const fd = fresh?.data as any;
  const td = thick?.data as any;
  const freshTier = fd?.tier_v3 ?? fd?.tier ?? 'BRONZE';
  const thickTier = td?.tier_v3 ?? td?.tier ?? 'GOLD';
  const freshConf = fd?.confidence !== undefined ? `${fd.confidence}%` : '—';
  const thickConf = td?.confidence !== undefined ? `${td.confidence}%` : '—';
  // scenario emits 'ceiling'; fall back to 'maxTxAmount' for backward compat
  const freshCeil = fd?.ceiling != null ? `$${fd.ceiling}` : fd?.maxTxAmount ? `$${fd.maxTxAmount}` : '—';
  const thickCeil = td?.ceiling != null ? `$${td.ceiling}` : td?.maxTxAmount ? `$${td.maxTxAmount}` : '—';
  return (
    <>
      <div className="flywheel-banner">
        <div className="fb-side">
          <div className="fb-tier" style={{ color: 'var(--signal)' }}>{freshTier}</div>
          <div className="fb-meta">fresh agent · {freshConf} confidence · ceil {freshCeil}</div>
          <div className="fb-meta" style={{ color: 'var(--faint)', marginTop: 2 }}>thin file — limited history</div>
        </div>
        <div className="fb-sep">→</div>
        <div className="fb-side" style={{ textAlign: 'right' }}>
          <div className="fb-tier" style={{ color: 'var(--mesh-2)' }}>{thickTier}</div>
          <div className="fb-meta">thick-file agent · {thickConf} confidence · ceil {thickCeil}</div>
          <div className="fb-meta" style={{ color: 'var(--credit)', marginTop: 2 }}>rich history — higher trust, higher limit</div>
        </div>
      </div>
      <div className="flywheel-caption">More payments → richer on-chain history → higher score → better terms. The flywheel is self-reinforcing.</div>
    </>
  );
}

// ── the agent mind panel — the real LLM reasoning, surfaced ──
// Phases that produce chain-of-thought; while one is the live active step the
// panel shows a "thinking" pulse until its reasoning lands.
const REASONING_PHASES = new Set(['reasoning', 'payment', 'denial']);

function MindPanel({ step, activeStep, running, brain }: { step?: DemoStep; activeStep?: DemoStep; running: boolean; brain: string }) {
  const data = step?.data as any;
  const reasoning = data?.reasoning ?? '';
  const decision = data?.decision as string | undefined;
  const rationale = (data?.rationale ?? data?.plan) as string | undefined;
  const thinking = !!(running && activeStep && activeStep.status === 'active'
    && REASONING_PHASES.has(activeStep.phase) && activeStep.id !== step?.id);
  const typed = useTypewriter(thinking ? '' : reasoning);
  const headActor = thinking ? activeStep!.actor : (step?.actor ?? 'Aria');
  return (
    <div className={'mind' + (thinking ? ' thinking' : '')}>
      <div className="mind-h">
        <span className="mind-dot" />
        <span className="mind-title">{headActor} · agent reasoning</span>
        <span className="mind-model">{data?.fallback ? 'fallback' : (data?.model ?? brain)}</span>
      </div>
      {!step && !thinking && <div className="mind-idle">The agent reasons about each payment before it moves money. Its full chain-of-thought appears here — and the verdict actually gates the next step.</div>}
      {thinking && <div className="mind-idle thinking-line">thinking<span className="dots"><i>.</i><i>.</i><i>.</i></span></div>}
      {!thinking && reasoning && (
        <div className="mind-chain">{typed}<span className="caret">▌</span></div>
      )}
      {!thinking && (decision || rationale) && (
        <div className="mind-verdict">
          {decision && <span className={'verdict-pill ' + (decision === 'PROCEED' ? 'go' : 'hold')}>{decision === 'PROCEED' ? '✓ PROCEED' : '✋ HOLD'}</span>}
          {rationale && <span className="mind-rationale">{rationale}</span>}
          {data?.ms ? <span className="mind-lat">{(data.ms / 1000).toFixed(1)}s · {data.model}</span> : null}
        </div>
      )}
    </div>
  );
}

// ── a single step card in the timeline ──
// kya_thick gets a special contrast class to contrast the data-flywheel
const CONTRAST_IDS = new Set(['kya_thick']);

function StepCard({ s }: { s: DemoStep }) {
  // Case dividers render as full-width section markers, not timeline cards.
  if ((s.data as any)?.caseHeader) return <CaseDivider s={s} />;
  const icon = s.status === 'active' ? <span className="sc-spin" /> : s.status === 'denied' ? '✕' : s.status === 'info' ? '◌' : '✓';
  const extraClass = CONTRAST_IDS.has(s.id) ? ' contrast-kya' : '';
  const isDenied = s.status === 'denied';
  return (
    <div className={'step-card ' + s.status + extraClass}>
      <div className="sc-rail"><span className="sc-icon">{icon}</span></div>
      <div className="sc-body">
        <div className="sc-top">
          <span className="sc-phase">{PHASE_LABEL[s.phase] ?? s.phase}</span>
          <span className="sc-actor">{s.actor}</span>
        </div>
        <div className="sc-title">{s.title}</div>
        {s.body && <div className="sc-text">{s.body}</div>}
        {/* Denial explanation banner — makes each halted case legible for judges */}
        {isDenied && <DenialBanner stepId={s.id} data={s.data as any} />}
        <StepData s={s} />
        {/* The agent's real chain-of-thought for this decision, surfaced in full */}
        <ReasoningBlock data={s.data as any} actor={s.actor} />
        {s.tx && (
          <a className="sc-tx" href={s.tx.url} target="_blank" rel="noreferrer">
            <span className="sc-tx-kind">{s.tx.kind}</span>{s.tx.label}<span className="sc-tx-arr"> ↗</span>
          </a>
        )}
      </div>
    </div>
  );
}

// ── a case divider — bounds one payment case and shows its verdict ──
function CaseDivider({ s }: { s: DemoStep }) {
  const verdict = (s.data as any)?.verdict as 'APPROVED' | 'DENIED' | undefined;
  return (
    <div className={'case-divider' + (verdict ? ' ' + verdict.toLowerCase() : '')}>
      <div className="cd-head">
        <span className="cd-title">{s.title}</span>
        {verdict && (
          <span className={'cd-verdict ' + verdict.toLowerCase()}>
            {verdict === 'APPROVED' ? '✓ APPROVED' : '✕ DENIED · HALTED'}
          </span>
        )}
      </div>
      {s.body && <div className="cd-body">{s.body}</div>}
    </div>
  );
}

// ── the agent's chain-of-thought for one decision, rendered in full ──
function ReasoningBlock({ data, actor }: { data: any; actor: string }) {
  const reasoning = data?.reasoning as string | undefined;
  const conclusion = (data?.rationale ?? data?.plan) as string | undefined;
  const decision = data?.decision as string | undefined;
  if (!reasoning && !conclusion) return null;
  return (
    <details className="sc-reasoning" open>
      <summary className="scr-head">
        <span className="scr-dot" />
        <span className="scr-who">{actor} · reasoning</span>
        {data?.model && <span className="scr-model">{data?.fallback ? 'fallback' : data.model}</span>}
        {data?.ms ? <span className="scr-lat">{(data.ms / 1000).toFixed(1)}s</span> : null}
      </summary>
      {reasoning && <div className="scr-chain">{reasoning}</div>}
      {conclusion && (
        <div className="scr-concl">
          {decision && <span className={'scr-pill ' + (decision === 'PROCEED' ? 'go' : 'hold')}>{decision}</span>}
          <span className="scr-concl-t">{conclusion}</span>
        </div>
      )}
    </details>
  );
}

// Denial-specific explanation banners
const DENIAL_REASONS: Record<string, (d: any) => string> = {
  // scenario emits tierCeiling and requestedAmount for denial_tier
  denial_tier:   (d) => `Tier ceiling $${d?.tierCeiling ?? d?.ceiling ?? d?.maxTxAmount ?? '?'} < requested $${d?.requestedAmount ?? d?.requested ?? d?.amount ?? '?'} — agent must earn a higher tier`,
  // scenario emits remaining, demoDelegationBudget (the per-run fleet budget), and requestedAmount
  denial_budget: (d) => `Fleet delegation budget exceeded — $${d?.remaining ?? '?'} of the $${d?.demoDelegationBudget ?? '?'} run budget remains, $${d?.requestedAmount ?? d?.requested ?? d?.amount ?? '?'} requested`,
  denial_aml:    (d) => `AML block — D6 matched sanctioned entity "${d?.matchedName ?? d?.amlTarget ?? '?'}" on OFAC SDN`,
  contrast:      ()  => 'Uncertified agent — ledger rejects with tecNO_PERMISSION before bank even sees it',
};

function DenialBanner({ stepId, data }: { stepId: string; data: any }) {
  const fn = DENIAL_REASONS[stepId];
  // Show a banner for the known denial steps, and for any case that halted.
  if (!fn && !data?.halted) return null;
  const reason = fn ? fn(data) : (data?.reason || data?.rationale || 'gate denied — payment attempt stopped');
  const halted = !!data?.halted;
  return (
    <div className="denied-banner" role="alert">
      <span className="db-icon">⊘</span>
      <span className="db-reason"><span className="db-label">{halted ? 'DENIED · HALTED' : 'DENIED'}</span> — {reason}{halted ? ' · no funds moved' : ''}</span>
    </div>
  );
}

// step-specific rich data
function StepData({ s }: { s: DemoStep }) {
  const d = s.data as any;
  if (!d) return null;

  // Helper: render dimension chips from a DimensionRecord array.
  const DimChips = ({ dims }: { dims: DimensionRecord[] }) => (
    <div className="sc-chips sc-dims">
      {dims.map((dim) => (
        <Chip
          key={dim.id}
          k={dim.id}
          v={dim.status}
          good={dim.status === 'PASS'}
          bad={dim.status === 'FAIL' || dim.status === 'DENY'}
        />
      ))}
    </div>
  );

  switch (s.id) {
    case 'kyb':
      return <div className="sc-chips"><Chip k="business tier" v={d.btier} /><Chip k="delegated cap" v={`$${d.maxDelegatedSpend}`} /><Chip k="jurisdiction" v={d.jurisdiction} /></div>;

    // v1 kya (legacy)
    case 'kya':
      return <div className="sc-chips"><Chip k="score" v={d.score} accent /><Chip k="tier" v={d.tier} accent /><Chip k="ceiling" v={`$${d.maxTxAmount}`} /></div>;

    // v2 KYA steps — show tier, confidence, and dimension breakdown
    case 'kya_fresh':
    case 'kya_thick': {
      const tier = d.tier_v3 ?? d.tier;
      const conf = d.confidence !== undefined ? `${d.confidence}%` : undefined;
      // scenario emits 'ceiling'; fall back to 'maxTxAmount' for backward compat
      const ceil = d.ceiling ?? d.maxTxAmount;
      return (
        <>
          <div className="sc-chips">
            <Chip k="tier" v={tier} accent />
            {conf && <Chip k="confidence" v={conf} />}
            <Chip k="ceiling" v={ceil !== undefined ? `$${ceil}` : '—'} />
            {/* Honest labels: these data sources are simulated/cached in the demo */}
            <span className="honest-tag" title="World ID proof uses IDKit simulator in demo">World ID = simulator</span>
            <span className="honest-tag" title="Zefix business registry uses cached fixture in demo">Zefix = cached</span>
          </div>
          {d.dimensions && <DimChips dims={d.dimensions} />}
        </>
      );
    }

    case 'mandate':
      return <div className="sc-chips"><Chip k="D5 mandate" v={d.mandateIssued ? 'issued' : 'pending'} good={!!d.mandateIssued} /></div>;

    case 'reason':
      return d.decision ? <div className="sc-chips"><Chip k="agent decision" v={d.decision} good={d.decision === 'PROCEED'} bad={d.decision !== 'PROCEED'} /></div> : null;

    // Settlement steps — scenario emits abstractAmount for settle_a/settle_b, amount for confirm_a
    case 'settle_a':
    case 'settle_b':
    case 'confirm_a': {
      const amt = d.abstractAmount ?? d.amount;
      const ok = d.verdict ? d.verdict === 'APPROVED' : true;
      return <div className="sc-chips">
        <Chip k="amount" v={amt ? `$${amt}` : '—'} />
        {d.amlAction && <Chip k="AML" v={d.amlAction} good={d.amlAction === 'PASS'} bad={d.amlAction === 'DENY'} />}
        {d.decision && <Chip k="agent" v={d.decision} good={d.decision === 'PROCEED'} bad={d.decision !== 'PROCEED'} />}
        <Chip k="verdict" v={ok ? 'SETTLED' : 'HALTED'} good={ok} bad={!ok} />
      </div>;
    }

    // Denial steps
    case 'denial_tier':
      // scenario emits tierCeiling and requestedAmount for this step
      return <div className="sc-chips"><Chip k="tier ceiling" v={`$${d.tierCeiling ?? d.ceiling ?? d.maxTxAmount ?? '?'}`} /><Chip k="requested" v={`$${d.requestedAmount ?? d.requested ?? d.amount ?? '?'}`} /><Chip k="verdict" v="DENIED" bad /></div>;

    case 'denial_budget':
      // scenario emits requestedAmount and remaining
      return <div className="sc-chips"><Chip k="remaining budget" v={`$${d.remaining ?? '—'}`} /><Chip k="requested" v={`$${d.requestedAmount ?? d.requested ?? d.amount ?? '?'}`} /><Chip k="verdict" v="DENIED" bad /></div>;

    case 'denial_aml':
      return <div className="sc-chips"><Chip k="D6 AML" v={d.amlAction ?? 'DENY'} bad /><Chip k="matched" v={d.matchedName ?? d.amlTarget ?? '—'} bad /><Chip k="verdict" v="BLOCKED" bad /></div>;

    case 'gatecheck':
      return <div className="sc-chips"><Chip k="amount" v={`$${d.amount}`} /><Chip k="ceiling" v={`$${d.maxTxAmount}`} /><Chip k={d.allowed ? 'gate' : 'gate'} v={d.allowed ? 'ALLOW' : 'DENY'} good={d.allowed} bad={!d.allowed} /></div>;

    case 'codeswap':
      return <div className="sc-chips"><Chip k="audited build" v="recognized" good /><Chip k="tampered build" v="rejected" bad /></div>;

    case 'contrast':
      return <div className="sc-chips"><Chip k="ledger verdict" v={d.code ?? 'tecNO_PERMISSION'} bad /></div>;

    case 'kill':
      // scenario emits compromisedGateAllowed and agentAGateAllowed
      return <div className="sc-chips">
        <Chip k="compromised gate" v={d.compromisedGateAllowed ? 'ALLOW' : 'DENY'} bad={!d.compromisedGateAllowed} />
        <Chip k="Aria gate" v={d.agentAGateAllowed ? 'ALLOW' : 'DENY'} good={!!d.agentAGateAllowed} />
      </div>;

    default:
      return null;
  }
}

function Chip({ k, v, accent, good, bad }: { k: string; v: any; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <span className={'chip' + (accent ? ' accent' : '') + (good ? ' good' : '') + (bad ? ' bad' : '')}>
      <span className="chip-k">{k}</span><span className="chip-v">{String(v ?? '—')}</span>
    </span>
  );
}
